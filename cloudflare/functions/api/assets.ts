import type { WorkerEnv } from "../_lib/types";
import { getR2Object } from "../_lib/r2";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message, message }, { status });
}

function safeAssetKey(value: string | null): string | null {
  const key = String(value || "").trim();
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\")) {
    return null;
  }
  return key;
}

export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: WorkerEnv;
}) {
  const url = new URL(request.url);
  const key = safeAssetKey(url.searchParams.get("key"));
  if (!key) return jsonError("invalid asset key", 400);

  const object = await getR2Object(env, key);
  if (!object) return jsonError("asset not found or R2 is not configured", 404);
  return object;
}
