import type { WorkerEnv } from "../../_lib/types";
import { searchPexelsImages, searchPexelsVideos } from "../../_lib/pexels";
import { searchPixabayMedia } from "../../_lib/pixabay";
import { requireCurrentUser } from "../../_lib/auth";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message, message }, { status });
}

function normalizeQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function backendUrl(env: WorkerEnv, path: string): string | null {
  const base = String(env.MONEYPRINTER_API_URL || "").replace(/\/+$/, "");
  return base ? `${base}/api/v1${path}` : null;
}

async function searchTerms(env: WorkerEnv, query: string): Promise<string[]> {
  const url = backendUrl(env, "/terms");
  if (!url) return [query];

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.MONEYPRINTER_API_TOKEN
        ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      video_subject: query,
      video_script: query,
      amount: 4,
      match_materials_to_script: true,
    }),
  }).catch(() => null);
  if (!response?.ok) return [query];

  const payload = (await response.json().catch(() => ({}))) as {
    data?: { video_terms?: unknown };
  };
  const terms = Array.isArray(payload.data?.video_terms)
    ? payload.data?.video_terms
    : [];
  const cleanTerms = terms
    .map((term) => String(term || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  return cleanTerms.length ? cleanTerms : [query];
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body");
  }

  const record = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const mediaType = String(record.mediaType || "video").toLowerCase();
  const style = String(record.style || "realistic").toLowerCase();
  const requestedProvider = String(record.provider || "auto").toLowerCase();
  const provider =
    requestedProvider === "pexels" || requestedProvider === "pixabay"
      ? requestedProvider
      : style === "animation"
        ? "pixabay"
        : "pexels";
  const query = normalizeQuery(record.query);
  if (mediaType !== "video" && mediaType !== "image") {
    return jsonError("invalid media type");
  }
  if (!query) {
    return jsonError("query is required");
  }
  if (query.length > 120) {
    return jsonError("query is too long");
  }

  try {
    const limit = Number(record.limit || 6);
    const generatedTerms = record.expandTerms === true ? await searchTerms(env, query) : [query];
    const terms = provider === "pixabay" ? generatedTerms.slice(0, 1) : generatedTerms;
    const seen = new Set<string>();
    const assets = [];
    for (const term of terms) {
      const termAssets =
        provider === "pixabay"
          ? await searchPixabayMedia(env, {
              query: term,
              limit: Math.max(3, Math.ceil(limit / terms.length)),
              mediaType: mediaType as "video" | "image",
              style: style === "animation" ? "animation" : "realistic",
            })
          : mediaType === "image"
            ? await searchPexelsImages(env, {
                query: term,
                limit: Math.ceil(limit / terms.length),
              })
            : await searchPexelsVideos(env, {
                query: term,
                limit: Math.ceil(limit / terms.length),
                persist: record.persist !== false,
                userId: user.id,
              });
      for (const asset of termAssets) {
        const key = asset.videoUrl || asset.imageUrl || asset.sourceUrl || asset.id;
        if (seen.has(key)) continue;
        seen.add(key);
        assets.push(asset);
        if (assets.length >= limit) break;
      }
      if (assets.length >= limit) break;
    }
    return Response.json({
      provider,
      mediaType,
      style,
      query,
      terms,
      persistedToR2: assets.some((asset) => asset.persisted),
      assets,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to search media",
      500
    );
  }
}
