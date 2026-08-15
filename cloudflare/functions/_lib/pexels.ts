import type { WorkerEnv } from "./types";
import { insertMediaAsset } from "./supabase";

const PEXELS_SEARCH_URL = "https://api.pexels.com/videos/search";
const PEXELS_IMAGE_SEARCH_URL = "https://api.pexels.com/v1/search";
const MAX_RESULTS = 8;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MIN_BACKEND_DIMENSION = 480;

interface R2LikeBucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
    }
  ): Promise<unknown>;
}

interface PexelsVideoFile {
  id?: number;
  width?: number;
  height?: number;
  link?: string;
  file_type?: string;
}

interface PexelsVideo {
  id?: number;
  width?: number;
  height?: number;
  duration?: number;
  image?: string;
  url?: string;
  video_files?: PexelsVideoFile[];
}

interface PexelsPhoto {
  id?: number;
  width?: number;
  height?: number;
  alt?: string;
  url?: string;
  src?: {
    original?: string;
    large2x?: string;
    large?: string;
    medium?: string;
  };
}

export interface MediaSearchAsset {
  id: string;
  provider: "pexels";
  type?: "video" | "image";
  title: string;
  duration: number;
  width: number;
  height: number;
  thumbnailUrl: string;
  videoUrl?: string;
  imageUrl?: string;
  assetKey: string | null;
  sourceUrl: string;
  persisted: boolean;
}

function pexelsKey(env: WorkerEnv): string {
  return String(env.PEXELS_APIKEY || env.PEXELS_API_KEY || "");
}

export function pexelsAvailable(env: WorkerEnv): boolean {
  return Boolean(pexelsKey(env));
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message, message }, { status });
}

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(1, Math.min(MAX_RESULTS, Math.round(parsed)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "clip";
}

function chooseVideoFile(video: PexelsVideo): PexelsVideoFile | null {
  const files = Array.isArray(video.video_files) ? video.video_files : [];
  const mp4Files = files.filter((file) => {
    const width = Number(file.width || 0);
    const height = Number(file.height || 0);
    return file.link && width > 0 && height > 0 && height >= width;
  });

  const candidates = mp4Files.length ? mp4Files : files.filter((file) => file.link);
  if (!candidates.length) return null;

  return candidates
    .slice()
    .sort((a, b) => {
      const aWidth = Number(a.width || 0);
      const bWidth = Number(b.width || 0);
      const aHeight = Number(a.height || 0);
      const bHeight = Number(b.height || 0);
      const aScore = Math.abs(aHeight / Math.max(aWidth, 1) - 16 / 9);
      const bScore = Math.abs(bHeight / Math.max(bWidth, 1) - 16 / 9);
      const aTooSmall = aWidth < MIN_BACKEND_DIMENSION || aHeight < MIN_BACKEND_DIMENSION ? 1 : 0;
      const bTooSmall = bWidth < MIN_BACKEND_DIMENSION || bHeight < MIN_BACKEND_DIMENSION ? 1 : 0;
      if (aTooSmall !== bTooSmall) return aTooSmall - bTooSmall;
      if (aScore !== bScore) return aScore - bScore;
      return aWidth - bWidth;
    })[0];
}

function assetUrlFromKey(key: string): string {
  return `/api/assets?key=${encodeURIComponent(key)}`;
}

async function persistPexelsVideo(
  env: WorkerEnv,
  query: string,
  video: PexelsVideo,
  file: PexelsVideoFile
): Promise<{ assetKey: string | null; videoUrl: string; persisted: boolean }> {
  const sourceUrl = String(file.link || "");
  const bucket = env.VIDEO_ASSETS as R2LikeBucket | undefined;
  if (!bucket) {
    return { assetKey: null, videoUrl: sourceUrl, persisted: false };
  }

  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body) {
    return { assetKey: null, videoUrl: sourceUrl, persisted: false };
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_VIDEO_BYTES) {
    return { assetKey: null, videoUrl: sourceUrl, persisted: false };
  }

  const key = `pexels/${slugify(query)}-${video.id || crypto.randomUUID()}-${
    file.id || crypto.randomUUID()
  }.mp4`;
  await bucket.put(key, response.body, {
    httpMetadata: {
      contentType: response.headers.get("content-type") || "video/mp4",
    },
  });

  return { assetKey: key, videoUrl: assetUrlFromKey(key), persisted: true };
}

export async function searchPexelsVideos(
  env: WorkerEnv,
  options: {
    query: string;
    limit?: number;
    persist?: boolean;
    userId?: string;
  }
): Promise<MediaSearchAsset[]> {
  const key = pexelsKey(env);
  if (!key) {
    throw new Error("PEXELS_APIKEY is not configured");
  }

  const limit = clampLimit(options.limit);
  const url = new URL(PEXELS_SEARCH_URL);
  url.searchParams.set("query", options.query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("per_page", String(limit));

  const response = await fetch(url, {
    headers: {
      Authorization: key,
      "User-Agent": "MoneyPrinterTurbo Cloud",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof (payload as Record<string, unknown>).error === "string"
        ? String((payload as Record<string, unknown>).error)
        : `Pexels search failed: ${response.status}`;
    throw new Error(message);
  }

  const videos = Array.isArray((payload as Record<string, unknown>).videos)
    ? ((payload as Record<string, unknown>).videos as PexelsVideo[])
    : [];

  const assets: MediaSearchAsset[] = [];
  for (const video of videos) {
    const file = chooseVideoFile(video);
    if (!file?.link) continue;
    const selectedWidth = Number(file.width || video.width || 0);
    const selectedHeight = Number(file.height || video.height || 0);
    if (selectedWidth < MIN_BACKEND_DIMENSION || selectedHeight < MIN_BACKEND_DIMENSION) {
      continue;
    }

    const persisted = options.persist === false
      ? { assetKey: null, videoUrl: String(file.link), persisted: false }
      : await persistPexelsVideo(env, options.query, video, file);

    assets.push({
      id: `pexels-${video.id || assets.length}`,
      provider: "pexels",
      title: options.query,
      duration: Number(video.duration || 4) || 4,
      width: selectedWidth,
      height: selectedHeight,
      thumbnailUrl: String(video.image || ""),
      videoUrl: persisted.videoUrl,
      assetKey: persisted.assetKey,
      sourceUrl: String(video.url || ""),
      persisted: persisted.persisted,
    });
    await insertMediaAsset(env, {
      id: `pexels-video-${video.id || file.id || crypto.randomUUID()}`,
      user_id: options.userId || null,
      type: "video",
      provider: "pexels",
      title: options.query,
      prompt: options.query,
      asset_key: persisted.assetKey,
      asset_url: persisted.videoUrl,
      duration: Number(video.duration || 4) || 4,
      metadata: {
        width: Number(file.width || video.width || 0),
        height: Number(file.height || video.height || 0),
        thumbnail_url: String(video.image || ""),
        source_url: String(video.url || ""),
        persisted: persisted.persisted,
      },
    }).catch(() => null);
  }

  return assets;
}

export async function searchPexelsImages(
  env: WorkerEnv,
  options: {
    query: string;
    limit?: number;
  }
): Promise<MediaSearchAsset[]> {
  const key = pexelsKey(env);
  if (!key) {
    throw new Error("PEXELS_APIKEY is not configured");
  }

  const limit = clampLimit(options.limit);
  const url = new URL(PEXELS_IMAGE_SEARCH_URL);
  url.searchParams.set("query", options.query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("per_page", String(limit));

  const response = await fetch(url, {
    headers: {
      Authorization: key,
      "User-Agent": "MoneyPrinterTurbo Cloud",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof (payload as Record<string, unknown>).error === "string"
        ? String((payload as Record<string, unknown>).error)
        : `Pexels image search failed: ${response.status}`;
    throw new Error(message);
  }

  const photos = Array.isArray((payload as Record<string, unknown>).photos)
    ? ((payload as Record<string, unknown>).photos as PexelsPhoto[])
    : [];

  return photos
    .map((photo, index) => {
      const src = photo.src || {};
      const imageUrl = String(src.large2x || src.large || src.original || "");
      if (!imageUrl) return null;
      return {
        id: `pexels-image-${photo.id || index}`,
        provider: "pexels" as const,
        type: "image" as const,
        title: photo.alt || options.query,
        duration: 0,
        width: Number(photo.width || 0),
        height: Number(photo.height || 0),
        thumbnailUrl: String(src.medium || src.large || imageUrl),
        imageUrl,
        assetKey: null,
        sourceUrl: String(photo.url || ""),
        persisted: false,
      };
    })
    .filter(Boolean) as MediaSearchAsset[];
}

export { jsonError };
