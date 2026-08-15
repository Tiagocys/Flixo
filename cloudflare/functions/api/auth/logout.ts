import { bearerToken, jsonAuthError, supabaseAuthFetch } from "../../_lib/auth";
import type { WorkerEnv } from "../../_lib/types";

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ ok: true });
  }

  const response = await supabaseAuthFetch(env, "logout", { method: "POST" }, token).catch(
    (error) => jsonAuthError(error instanceof Error ? error.message : "Falha ao sair.", 503)
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return jsonAuthError(String(body.error_description || body.msg || body.message || "Falha ao sair."), response.status);
  }
  return Response.json({ ok: true });
};
