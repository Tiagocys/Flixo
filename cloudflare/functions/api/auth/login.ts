import { jsonAuthError, supabaseAuthFetch } from "../../_lib/auth";
import type { WorkerEnv } from "../../_lib/types";

function normalizeCredentials(payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    email: String(record.email || "").trim().toLowerCase(),
    password: String(record.password || ""),
  };
}

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonAuthError("JSON invalido.", 400);
  }

  const credentials = normalizeCredentials(payload);
  if (!credentials.email || !credentials.password) {
    return jsonAuthError("Informe email e senha.", 400);
  }

  const response = await supabaseAuthFetch(env, "token?grant_type=password", {
    method: "POST",
    body: JSON.stringify(credentials),
  }).catch((error) => jsonAuthError(error instanceof Error ? error.message : "Falha no login.", 503));

  if (response instanceof Response && !response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return jsonAuthError(String(body.error_description || body.msg || body.message || "Email ou senha invalidos."), response.status);
  }

  return Response.json(await response.json());
};
