import type { WorkerEnv } from "../_lib/types";

interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: {
    contentType?: string;
  };
  size?: number;
  writeHttpMetadata?(headers: Headers): void;
}

interface R2LikeBucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

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
  const bucket = env.VIDEO_ASSETS as R2LikeBucket | undefined;
  if (!bucket) return jsonError("R2 bucket is not configured", 503);

  const url = new URL(request.url);
  const key = safeAssetKey(url.searchParams.get("key"));
  if (!key) return jsonError("invalid asset key", 400);

  const object = await bucket.get(key);
  if (!object) return jsonError("asset not found", 404);

  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set("Content-Type", headers.get("Content-Type") || "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=3600");
  if (typeof object.size === "number") {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(object.body, { headers });
}
