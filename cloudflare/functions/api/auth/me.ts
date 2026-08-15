import { authConfigured, getCurrentUser } from "../../_lib/auth";
import type { WorkerEnv } from "../../_lib/types";

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  if (!authConfigured(env)) {
    return Response.json({ configured: false, user: null }, { status: 503 });
  }
  const user = await getCurrentUser(request, env);
  if (!user) {
    return Response.json({ configured: true, user: null }, { status: 401 });
  }
  return Response.json({
    configured: true,
    user: {
      id: user.id,
      email: user.email,
      raw: user.raw,
    },
  });
};
