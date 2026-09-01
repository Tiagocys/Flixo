import type { WorkerEnv } from "../../_lib/types";
import { requireCurrentUser } from "../../_lib/auth";

function jsonError(message: string, status = 410) {
  return Response.json({ error: message, message }, { status });
}

export async function onRequestPost({
  request,
  env,
}: {
  request: Request;
  env: WorkerEnv;
}) {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;

  return jsonError(
    "Busca em bancos externos de mídia desativada temporariamente."
  );
}
