import { jsonAuthError, supabaseAuthFetch } from "../../_lib/auth";
import type { WorkerEnv } from "../../_lib/types";

function normalizeSignup(payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const name = String(record.name || "").trim();
  return {
    email: String(record.email || "").trim().toLowerCase(),
    password: String(record.password || ""),
    data: name ? { name } : undefined,
  };
}

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonAuthError("JSON invalido.", 400);
  }

  const signup = normalizeSignup(payload);
  if (!signup.email || !signup.password) {
    return jsonAuthError("Informe email e senha.", 400);
  }
  if (signup.password.length < 6) {
    return jsonAuthError("A senha precisa ter pelo menos 6 caracteres.", 400);
  }

  const response = await supabaseAuthFetch(env, "signup", {
    method: "POST",
    body: JSON.stringify(signup),
  }).catch((error) => jsonAuthError(error instanceof Error ? error.message : "Falha no cadastro.", 503));

  if (response instanceof Response && !response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return jsonAuthError(String(body.error_description || body.msg || body.message || "Nao foi possivel criar a conta."), response.status);
  }

  return Response.json(await response.json());
};
