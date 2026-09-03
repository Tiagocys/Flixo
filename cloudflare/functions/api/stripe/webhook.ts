import {
  getBillingCustomerByStripeCustomerId,
  insertStripeEvent,
  stripeEventProcessed,
  upsertBillingCustomer,
} from "../../_lib/supabase";
import {
  retrieveStripeSubscription,
  subscriptionCurrentPeriodEnd,
  stripeWebhookSecret,
  verifyStripeWebhook,
  type StripeEvent,
  type StripeObject,
} from "../../_lib/stripe";
import type { WorkerEnv } from "../../_lib/types";

function objectId(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "id" in value) {
    return String((value as { id?: unknown }).id || "");
  }
  return "";
}

function metadataUserId(object: StripeObject): string {
  const metadata = object.metadata;
  if (typeof metadata === "object" && metadata && "user_id" in metadata) {
    return String((metadata as { user_id?: unknown }).user_id || "");
  }
  return "";
}

function subscriptionPriceId(subscription: StripeObject): string | null {
  const items = subscription.items;
  if (typeof items !== "object" || !items || !("data" in items)) return null;
  const data = (items as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const first = data[0] as { price?: { id?: string } } | undefined;
  return first?.price?.id || null;
}

async function userIdFromCustomer(env: WorkerEnv, customerId: string): Promise<string> {
  if (!customerId) return "";
  const existing = await getBillingCustomerByStripeCustomerId(env, customerId).catch(() => null);
  return existing?.user_id || "";
}

async function persistSubscription(
  env: WorkerEnv,
  subscription: StripeObject,
  fallbackUserId = ""
): Promise<void> {
  const customerId = objectId(subscription.customer);
  const userId =
    metadataUserId(subscription) || fallbackUserId || (await userIdFromCustomer(env, customerId));
  if (!userId) return;
  await upsertBillingCustomer(env, {
    user_id: userId,
    stripe_customer_id: customerId || null,
    stripe_subscription_id: String(subscription.id || "") || null,
    stripe_price_id: subscriptionPriceId(subscription),
    status: String(subscription.status || "unknown"),
    current_period_end: subscriptionCurrentPeriodEnd(subscription),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    metadata: {
      latest_stripe_subscription_event: subscription.id || null,
    },
  });
}

async function handleCheckoutCompleted(env: WorkerEnv, object: StripeObject): Promise<void> {
  if (object.mode !== "subscription") return;
  const subscriptionId = objectId(object.subscription);
  if (!subscriptionId) return;
  const subscription = await retrieveStripeSubscription(env, subscriptionId);
  const fallbackUserId = metadataUserId(object) || String(object.client_reference_id || "");
  await persistSubscription(env, subscription, fallbackUserId);
}

async function handleSubscriptionEvent(env: WorkerEnv, object: StripeObject): Promise<void> {
  await persistSubscription(env, object);
}

async function handleInvoiceEvent(env: WorkerEnv, object: StripeObject, status: string): Promise<void> {
  const subscriptionId = objectId(object.subscription);
  if (!subscriptionId) return;
  const subscription = await retrieveStripeSubscription(env, subscriptionId).catch(() => null);
  if (subscription) {
    await persistSubscription(env, { ...subscription, status });
  }
}

async function processStripeEvent(env: WorkerEnv, event: StripeEvent): Promise<void> {
  const object = event.data.object;
  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(env, object);
    return;
  }
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.paused" ||
    event.type === "customer.subscription.resumed"
  ) {
    await handleSubscriptionEvent(env, object);
    return;
  }
  if (event.type === "invoice.payment_succeeded") {
    await handleInvoiceEvent(env, object, "active");
    return;
  }
  if (event.type === "invoice.payment_failed") {
    await handleInvoiceEvent(env, object, "past_due");
  }
}

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const payload = await request.text();
  let event: StripeEvent;
  try {
    event = await verifyStripeWebhook(
      payload,
      request.headers.get("Stripe-Signature"),
      stripeWebhookSecret(env)
    );
  } catch (error) {
    return Response.json(
      { error: "Webhook Stripe invalido.", message: error instanceof Error ? error.message : "Falha de assinatura." },
      { status: 400 }
    );
  }

  if (await stripeEventProcessed(env, event.id)) {
    return Response.json({ received: true, duplicate: true });
  }

  await processStripeEvent(env, event);
  await insertStripeEvent(env, { id: event.id, type: event.type, data: event as unknown as Record<string, unknown> });
  return Response.json({ received: true });
};
