import type { WorkerEnv } from "./types";

export interface StripeObject {
  id?: string;
  object?: string;
  [key: string]: unknown;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: StripeObject;
  };
}

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const WEBHOOK_TOLERANCE_SECONDS = 300;

export function stripeSecretKey(env: WorkerEnv): string {
  return String(env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_TEST || "").trim();
}

export function stripePublishableKey(env: WorkerEnv): string {
  return String(
    env.STRIPE_PUBLISHABLE_KEY || env.STRIPE_PUBLIC_KEY || env.STRIPE_PUBLIC_TEST || ""
  ).trim();
}

export function stripePriceId(env: WorkerEnv): string {
  return String(env.STRIPE_PRICE_ID || env.STRIPE_CLIPPER_BETA_PRICE_ID || "").trim();
}

export function stripeWebhookSecret(env: WorkerEnv): string {
  return String(env.STRIPE_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET_TEST || "").trim();
}

export function stripeConfigured(env: WorkerEnv): boolean {
  return Boolean(stripeSecretKey(env) && stripePriceId(env));
}

function authHeaders(env: WorkerEnv): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${stripeSecretKey(env)}`);
  headers.set("Content-Type", "application/x-www-form-urlencoded");
  return headers;
}

function appendFormValue(form: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  form.append(key, String(value));
}

async function stripePost<T>(
  env: WorkerEnv,
  path: string,
  params: Record<string, unknown>
): Promise<T> {
  if (!stripeSecretKey(env)) {
    throw new Error("Stripe Secret Key nao configurada.");
  }
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    appendFormValue(form, key, value);
  }
  const response = await fetch(`${STRIPE_API_BASE}/${path.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: authHeaders(env),
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload?.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message || "Erro na Stripe.")
        : "Erro na Stripe.";
    throw new Error(message);
  }
  return payload as T;
}

async function stripeGet<T>(env: WorkerEnv, path: string): Promise<T> {
  if (!stripeSecretKey(env)) {
    throw new Error("Stripe Secret Key nao configurada.");
  }
  const response = await fetch(`${STRIPE_API_BASE}/${path.replace(/^\/+/, "")}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey(env)}`,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload?.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message || "Erro na Stripe.")
        : "Erro na Stripe.";
    throw new Error(message);
  }
  return payload as T;
}

export async function createStripeCheckoutSession(
  env: WorkerEnv,
  options: {
    userId: string;
    email: string;
    origin: string;
    stripeCustomerId?: string | null;
  }
): Promise<{ id: string; url: string | null }> {
  const priceId = stripePriceId(env);
  if (!priceId) {
    throw new Error("Configure STRIPE_PRICE_ID com o Price ID do plano de assinatura.");
  }
  const successUrl = `${options.origin.replace(/\/+$/, "")}/clipper.html?billing=success`;
  const cancelUrl = `${options.origin.replace(/\/+$/, "")}/clipper.html?billing=cancel`;
  return stripePost(env, "checkout/sessions", {
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: options.userId,
    customer: options.stripeCustomerId || undefined,
    customer_email: options.stripeCustomerId ? undefined : options.email,
    allow_promotion_codes: "true",
    "consent_collection[terms_of_service]": "required",
    "custom_text[submit][message]":
      "Você está assinando o Clipper Beta. O preço atual é promocional durante o beta e o processamento pode demorar mais até a migração para servidor dedicado.",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[user_id]": options.userId,
    "subscription_data[metadata][user_id]": options.userId,
    "subscription_data[metadata][product]": "copacabena_clipper",
  });
}

export async function createStripePortalSession(
  env: WorkerEnv,
  options: { stripeCustomerId: string; origin: string }
): Promise<{ url: string | null }> {
  return stripePost(env, "billing_portal/sessions", {
    customer: options.stripeCustomerId,
    return_url: `${options.origin.replace(/\/+$/, "")}/clipper.html`,
  });
}

export async function retrieveStripeSubscription(
  env: WorkerEnv,
  subscriptionId: string
): Promise<StripeObject> {
  return stripeGet(env, `subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export function subscriptionStatusIsActive(status?: string | null): boolean {
  return ["active", "trialing"].includes(String(status || "").toLowerCase());
}

export function subscriptionCurrentPeriodEnd(subscription: StripeObject): string | null {
  const value = Number(subscription.current_period_end || 0);
  return value > 0 ? new Date(value * 1000).toISOString() : null;
}

export async function verifyStripeWebhook(
  payload: string,
  signatureHeader: string | null,
  secret: string
): Promise<StripeEvent> {
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET nao configurado.");
  }
  const signature = parseStripeSignature(signatureHeader);
  if (!signature.timestamp || !signature.signatures.length) {
    throw new Error("Assinatura Stripe ausente ou invalida.");
  }
  const age = Math.abs(Math.floor(Date.now() / 1000) - signature.timestamp);
  if (age > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("Assinatura Stripe expirada.");
  }
  const expected = await hmacSha256Hex(secret, `${signature.timestamp}.${payload}`);
  const valid = signature.signatures.some((candidate) => timingSafeEqual(candidate, expected));
  if (!valid) {
    throw new Error("Assinatura Stripe invalida.");
  }
  const event = JSON.parse(payload) as StripeEvent;
  if (!event?.id || !event?.type || !event?.data?.object) {
    throw new Error("Evento Stripe invalido.");
  }
  return event;
}

function parseStripeSignature(header: string | null): { timestamp: number; signatures: string[] } {
  const result = { timestamp: 0, signatures: [] as string[] };
  for (const part of String(header || "").split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") result.timestamp = Number(value || 0);
    if (key === "v1" && value) result.signatures.push(value);
  }
  return result;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
