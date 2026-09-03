import type { MediaAssetRow, WorkerEnv } from "../../_lib/types";
import { listMediaAssets } from "../../_lib/supabase";
import { requireCurrentUser } from "../../_lib/auth";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message, message }, { status });
}

function assetUrl(row: MediaAssetRow): string | null {
  if (row.asset_url) return row.asset_url;
  if (row.asset_key) return `/api/assets?key=${encodeURIComponent(row.asset_key)}`;
  return null;
}

function toClientAsset(row: MediaAssetRow) {
  return {
    id: row.id,
    type: row.type,
    provider: row.provider,
    title: row.title,
    prompt: row.prompt,
    duration: row.duration,
    assetKey: row.asset_key,
    url: assetUrl(row),
    videoUrl: row.type === "video" ? assetUrl(row) : null,
    audioUrl: row.type === "audio" ? assetUrl(row) : null,
    imageUrl: row.type === "image" ? assetUrl(row) : null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: WorkerEnv;
}) {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || undefined;
  if (type && type !== "video" && type !== "audio" && type !== "image") {
    return jsonError("invalid media asset type");
  }
  try {
    const assets = await listMediaAssets(env, {
      type,
      userId: user.id,
      limit: Number(url.searchParams.get("limit") || 12),
    });
    return Response.json({ assets: assets.map(toClientAsset), total: assets.length });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to list media assets",
      500
    );
  }
}
