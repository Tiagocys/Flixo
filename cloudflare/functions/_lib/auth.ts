import type { WorkerEnv } from "./types";

export interface AuthUser {
  id: string;
  email: string;
  raw: Record<string, unknown>;
}

export function supabaseProjectUrl(env: WorkerEnv): string {
  return String(env.SUPABASE_URL || env.SUPABASE_PROJECT_URL || "").replace(/\/+$/, "");
}

export function authConfigured(env: WorkerEnv): boolean {
  return Boolean(supabaseProjectUrl(env) && env.SUPABASE_ANON_KEY);
}

export function jsonAuthError(message: string, status = 401) {
  return Response.json({ error: message, message }, { status });
}

export function bearerToken(request: Request): string {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function authHeaders(env: WorkerEnv, token?: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("apikey", env.SUPABASE_ANON_KEY || "");
  headers.set("Authorization", token ? `Bearer ${token}` : `Bearer ${env.SUPABASE_ANON_KEY || ""}`);
  return headers;
}

export async function supabaseAuthFetch(
  env: WorkerEnv,
  path: string,
  init: RequestInit = {},
  token?: string
): Promise<Response> {
  const baseUrl = supabaseProjectUrl(env);
  if (!baseUrl || !env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase Auth nao configurado.");
  }
  return fetch(`${baseUrl}/auth/v1/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: authHeaders(env, token),
  });
}

export async function getCurrentUser(request: Request, env: WorkerEnv): Promise<AuthUser | null> {
  if (!authConfigured(env)) return null;
  const token = bearerToken(request);
  if (!token) return null;

  const response = await supabaseAuthFetch(env, "user", { method: "GET" }, token);
  if (!response.ok) return null;

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof payload?.id === "string" ? payload.id : "";
  const email = typeof payload?.email === "string" ? payload.email : "";
  if (!id) return null;
  return { id, email, raw: payload || {} };
}

export async function requireCurrentUser(
  request: Request,
  env: WorkerEnv
): Promise<AuthUser | Response> {
  if (!authConfigured(env)) {
    return jsonAuthError("Supabase Auth nao configurado.", 503);
  }
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonAuthError("Sessao invalida ou expirada.", 401);
  }
  return user;
}
