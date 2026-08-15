import { authConfigured, jsonAuthError, supabaseProjectUrl } from "../../../_lib/auth";
import type { WorkerEnv } from "../../../_lib/types";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  if (!authConfigured(env)) {
    return jsonAuthError("Supabase Auth nao configurado.", 503);
  }

  const requestUrl = new URL(request.url);
  const callback = new URL("/auth/callback.html", requestUrl.origin);
  callback.searchParams.set("next", safeNext(requestUrl.searchParams.get("next")));

  const target = new URL(`${supabaseProjectUrl(env)}/auth/v1/authorize`);
  target.searchParams.set("provider", "google");
  target.searchParams.set("redirect_to", callback.toString());

  return Response.redirect(target.toString(), 302);
};
