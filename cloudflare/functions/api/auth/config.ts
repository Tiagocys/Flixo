import { authConfigured, supabaseProjectUrl } from "../../_lib/auth";
import type { WorkerEnv } from "../../_lib/types";

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ env }) => {
  return Response.json({
    configured: authConfigured(env),
    supabaseUrl: supabaseProjectUrl(env) || null,
  });
};
