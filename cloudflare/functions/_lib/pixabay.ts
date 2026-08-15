import type { WorkerEnv } from "./types";

const PIXABAY_IMAGE_SEARCH_URL = "https://pixabay.com/api/";
const PIXABAY_VIDEO_SEARCH_URL = "https://pixabay.com/api/videos/";
const MAX_RESULTS = 8;

interface PixabayImageHit {
  id?: number;
  tags?: string;
  pageURL?: string;
  webformatURL?: string;
  largeImageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
}

interface PixabayVideoHit {
  id?: number;
  tags?: string;
  pageURL?: string;
  duration?: number;
  picture_id?: string;
  videos?: Record<
    string,
    {
      url?: string;
      width?: number;
      height?: number;
      size?: number;
    }
  >;
}

export interface PixabayMediaAsset {
  id: string;
  provider: "pixabay";
  type: "video" | "image";
  title: string;
  duration: number;
  width: number;
  height: number;
  thumbnailUrl: string;
  videoUrl?: string;
  imageUrl?: string;
  assetKey: null;
  sourceUrl: string;
  persisted: false;
}

function pixabayKey(env: WorkerEnv): string {
  return String(env.PIXABAY_APIKEY || env.PIXABAY_API_KEY || "");
}

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(3, Math.min(MAX_RESULTS, Math.round(parsed)));
}

function choosePixabayVideo(hit: PixabayVideoHit) {
  const videos = hit.videos || {};
  const candidates = ["small", "medium", "tiny", "large"]
    .map((quality, index) => ({ quality, index, file: videos[quality] }))
    .filter(({ file }) => file?.url && Number(file.width || 0) > 0 && Number(file.height || 0) > 0)
    .sort((a, b) => {
      const aPortrait = Number(a.file?.height || 0) >= Number(a.file?.width || 0) ? 0 : 1;
      const bPortrait = Number(b.file?.height || 0) >= Number(b.file?.width || 0) ? 0 : 1;
      if (aPortrait !== bPortrait) return aPortrait - bPortrait;
      return a.index - b.index;
    });
  return candidates[0]?.file || null;
}

export async function searchPixabayMedia(
  env: WorkerEnv,
  options: {
    query: string;
    limit?: number;
    mediaType?: "video" | "image";
    style?: "realistic" | "animation";
  }
): Promise<PixabayMediaAsset[]> {
  const key = pixabayKey(env);
  if (!key) {
    throw new Error("PIXABAY_APIKEY is not configured");
  }

  const limit = clampLimit(options.limit);
  const mediaType = options.mediaType || "image";
  const style = options.style || "animation";
  const query = style === "animation" ? `${options.query} cartoon illustration` : options.query;
  const url = new URL(mediaType === "video" ? PIXABAY_VIDEO_SEARCH_URL : PIXABAY_IMAGE_SEARCH_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(limit));
  url.searchParams.set("safesearch", "true");

  if (mediaType === "video") {
    url.searchParams.set("video_type", style === "animation" ? "animation" : "film");
  } else {
    url.searchParams.set("image_type", style === "animation" ? "illustration" : "photo");
    url.searchParams.set("orientation", "vertical");
  }

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Pixabay search failed: ${response.status}`);
  }

  const hits = Array.isArray((payload as Record<string, unknown>).hits)
    ? ((payload as Record<string, unknown>).hits as Array<PixabayImageHit | PixabayVideoHit>)
    : [];

  return hits
    .map((hit, index) => {
      if (mediaType === "video") {
        const videoHit = hit as PixabayVideoHit;
        const file = choosePixabayVideo(videoHit);
        if (!file?.url) return null;
        return {
          id: `pixabay-video-${videoHit.id || index}`,
          provider: "pixabay" as const,
          type: "video" as const,
          title: videoHit.tags || options.query,
          duration: Number(videoHit.duration || 4) || 4,
          width: Number(file.width || 0),
          height: Number(file.height || 0),
          thumbnailUrl: videoHit.picture_id
            ? `https://i.vimeocdn.com/video/${videoHit.picture_id}_640x360.jpg`
            : "",
          videoUrl: String(file.url),
          assetKey: null,
          sourceUrl: String(videoHit.pageURL || ""),
          persisted: false as const,
        };
      }

      const imageHit = hit as PixabayImageHit;
      const imageUrl = String(imageHit.webformatURL || imageHit.largeImageURL || "");
      if (!imageUrl) return null;
      return {
        id: `pixabay-image-${imageHit.id || index}`,
        provider: "pixabay" as const,
        type: "image" as const,
        title: imageHit.tags || options.query,
        duration: 0,
        width: Number(imageHit.imageWidth || 0),
        height: Number(imageHit.imageHeight || 0),
        thumbnailUrl: imageUrl,
        imageUrl,
        assetKey: null,
        sourceUrl: String(imageHit.pageURL || ""),
        persisted: false as const,
      };
    })
    .filter(Boolean) as PixabayMediaAsset[];
}
