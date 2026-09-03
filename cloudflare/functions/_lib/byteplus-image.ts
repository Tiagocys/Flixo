import { putR2Object } from "./r2";
import { insertMediaAsset } from "./supabase";
import { createJobId, type MediaAssetRow, type WorkerEnv } from "./types";

const DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const DEFAULT_IMAGE_MODEL = "seedream-5-0-lite-260128";

const IMAGE_MODEL_IDS: Record<string, string> = {
  economy: "seedream-5-0-lite-260128",
  quality: "seedream-4-5-251128",
  "Dola-Seedream-5.0-lite": "seedream-5-0-lite-260128",
  "dola-seedream-5.0-lite": "seedream-5-0-lite-260128",
  "dola-seedream-5-0-lite": "seedream-5-0-lite-260128",
  "seedream-5-0-lite": "seedream-5-0-lite-260128",
  "seedream-5-0-lite-260128": "seedream-5-0-lite-260128",
  "ByteDance-Seedream-4.5": "seedream-4-5-251128",
  "seedream-4.5": "seedream-4-5-251128",
  "seedream-4-5": "seedream-4-5-251128",
  "seedream-4-5-251128": "seedream-4-5-251128",
};

const SIZE_VALUES: Record<string, string> = {
  "2k": "2k",
  "3k": "3k",
  "4k": "4k",
};

function apiKey(env: WorkerEnv): string {
  return String(env.BYTEPLUS_APIKEY || env.BYTEPLUS_API_KEY || env.ARK_API_KEY || "");
}

function baseUrl(env: WorkerEnv): string {
  return String(env.BYTEPLUS_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function imageModel(value: unknown): string {
  const selected = String(value || DEFAULT_IMAGE_MODEL);
  return IMAGE_MODEL_IDS[selected] || selected;
}

function imageSize(value: unknown): string {
  const size = String(value || "2k").toLowerCase();
  return SIZE_VALUES[size] || "2k";
}

function outputFormat(value: unknown): string {
  const format = String(value || "jpeg").toLowerCase();
  return ["jpeg", "png", "webp"].includes(format) ? format : "jpeg";
}

function imageFromSettings(settings: Record<string, unknown>): string {
  return String(settings.imageDataUrl || settings.imageUrl || "").trim();
}

async function arkFetch(env: WorkerEnv, path: string, init: RequestInit) {
  const key = apiKey(env);
  if (!key) {
    throw new Error("BYTEPLUS_APIKEY is not configured");
  }

  return fetch(`${baseUrl(env)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...(init.headers || {}),
    },
  });
}

function extractError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  if (typeof record.message === "string") return record.message;
  return null;
}

function extractImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const data = Array.isArray(record.data) ? record.data : [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.url === "string") return entry.url;
    if (typeof entry.image_url === "string") return entry.image_url;
    if (typeof entry.b64_json === "string") return `data:image/png;base64,${entry.b64_json}`;
  }
  const output = record.output as Record<string, unknown> | undefined;
  if (typeof output?.image_url === "string") return output.image_url;
  if (typeof record.url === "string") return record.url;
  if (typeof record.image_url === "string") return record.image_url;
  return null;
}

async function persistImageIfConfigured(
  env: WorkerEnv,
  assetId: string,
  imageUrl: string,
  format: string
): Promise<{ key: string | null; url: string }> {
  const extension = format === "png" || format === "webp" ? format : "jpg";
  const key = `byteplus/images/${assetId}.${extension}`;
  const contentType = `image/${format === "jpg" ? "jpeg" : format}`;

  if (imageUrl.startsWith("data:")) {
    const [, payload = ""] = imageUrl.split(",");
    const binary = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
    const stored = await putR2Object(env, key, binary.buffer, contentType);
    return stored ? { key, url: `/api/assets?key=${encodeURIComponent(key)}` } : { key: null, url: imageUrl };
  }

  const response = await fetch(imageUrl);
  if (!response.ok) return { key: null, url: imageUrl };
  const body = await response.arrayBuffer();
  const stored = await putR2Object(env, key, body, response.headers.get("content-type") || contentType);
  return stored ? { key, url: `/api/assets?key=${encodeURIComponent(key)}` } : { key: null, url: imageUrl };
}

export function bytePlusImageAvailable(env: WorkerEnv): boolean {
  return Boolean(apiKey(env));
}

export async function generateBytePlusImage(
  env: WorkerEnv,
  options: {
    prompt: string;
    userId?: string | null;
    settings?: Record<string, unknown>;
  }
): Promise<MediaAssetRow> {
  const settings = options.settings || {};
  const format = outputFormat(settings.outputFormat);
  const image = imageFromSettings(settings);
  const body: Record<string, unknown> = {
    model: imageModel(settings.model || settings.qualityPreset),
    prompt: options.prompt,
    response_format: "url",
    size: imageSize(settings.size),
    watermark: false,
    output_format: format,
  };

  if (image) {
    body.image = image;
  }

  const response = await arkFetch(env, "/images/generations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `failed to create BytePlus Seedream image: ${response.status} ${
        extractError(payload) || ""
      }`.trim()
    );
  }

  const imageUrl = extractImageUrl(payload);
  if (!imageUrl) {
    throw new Error("BytePlus response did not include an image URL");
  }

  const assetId = `image-${createJobId()}`;
  const persisted = await persistImageIfConfigured(env, assetId, imageUrl, format);
  return insertMediaAsset(env, {
    id: assetId,
    user_id: options.userId || null,
    type: "image",
    provider: "byteplus",
    title: options.prompt,
    prompt: options.prompt,
    asset_key: persisted.key,
    asset_url: persisted.url,
    duration: null,
    metadata: {
      model: body.model,
      quality_preset: settings.qualityPreset || null,
      size: body.size,
      output_format: format,
      source_image_provided: Boolean(image),
    },
  });
}
