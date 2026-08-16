import { jsonAuthError, supabaseAuthFetch } from "../../_lib/auth";
import type { WorkerEnv } from "../../_lib/types";

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonAuthError("JSON invalido.", 400);
  }

  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const refreshToken = String(record.refresh_token || "").trim();
  if (!refreshToken) {
    return jsonAuthError("Refresh token ausente.", 400);
  }

  const response = await supabaseAuthFetch(env, "token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  }).catch((error) => jsonAuthError(error instanceof Error ? error.message : "Falha ao renovar sessao.", 503));

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return jsonAuthError(
      String(body.error_description || body.msg || body.message || "Sessao invalida ou expirada."),
      response.status
    );
  }

  return Response.json(await response.json());
};
