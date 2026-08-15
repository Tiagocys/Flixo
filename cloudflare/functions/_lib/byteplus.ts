import {
  createTimelineEntry,
  type JobRow,
  type JobSettings,
  type WorkerEnv,
} from "./types";
import { insertMediaAsset } from "./supabase";

const DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const DEFAULT_VIDEO_MODEL = "seedance-1-5-pro-251215";

const MODEL_IDS: Record<string, string> = {
  "seedance-1.0-pro-fast": "seedance-1-0-pro-fast-251015",
  "seedance-1.0-pro": "seedance-1-0-pro-250528",
  "seedance-1.5-pro": "seedance-1-5-pro-251215",
  "ByteDance-Seedance-1.0-pro-fast": "seedance-1-0-pro-fast-251015",
  "ByteDance-Seedance-1.0-pro": "seedance-1-0-pro-250528",
  "ByteDance-Seedance-1.5-pro": "seedance-1-5-pro-251215",
  "seedance-1-0-pro-fast-251015": "seedance-1-0-pro-fast-251015",
  "seedance-1-0-pro-250528": "seedance-1-0-pro-250528",
  "seedance-1-5-pro-251215": "seedance-1-5-pro-251215",
};

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

function apiKey(env: WorkerEnv): string {
  return String(env.BYTEPLUS_APIKEY || env.BYTEPLUS_API_KEY || env.ARK_API_KEY || "");
}

function baseUrl(env: WorkerEnv): string {
  return String(env.BYTEPLUS_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function modelId(settings: JobSettings): string {
  const selected = String(settings.model || DEFAULT_VIDEO_MODEL);
  return MODEL_IDS[selected] || selected;
}

function clampDuration(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4;
  return Math.max(2, Math.min(12, Math.round(parsed)));
}

function normalizeResolution(value: unknown): string {
  const resolution = String(value || "720p").toLowerCase();
  return ["480p", "720p", "1080p"].includes(resolution) ? resolution : "720p";
}

function normalizeRatio(value: unknown): string {
  const ratio = String(value || "9:16");
  return ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(ratio) ? ratio : "9:16";
}

function textPrompt(prompt: string, settings: JobSettings): string {
  const duration = clampDuration(settings.duration);
  const resolution = normalizeResolution(settings.resolution);
  const cameraFixed = settings.cameraFixed === true ? "true" : "false";
  return `${prompt.trim()} --resolution ${resolution} --duration ${duration} --camerafixed ${cameraFixed}`;
}

function imageUrl(settings: JobSettings): string {
  return String(settings.imageDataUrl || settings.imageUrl || "").trim();
}

function taskPayload(prompt: string, settings: JobSettings) {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: textPrompt(prompt, settings),
    },
  ];

  const image = imageUrl(settings);
  if (image) {
    content.push({
      type: "image_url",
      image_url: { url: image },
      role: "first_frame",
    });
  }

  return {
    model: modelId(settings),
    content,
    duration: clampDuration(settings.duration),
    resolution: normalizeResolution(settings.resolution),
    ratio: normalizeRatio(settings.ratio),
    camera_fixed: settings.cameraFixed === true,
    watermark: false,
    generate_audio: false,
  };
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

function extractTaskId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  return String(record.id || record.task_id || record.taskId || "").trim() || null;
}

function extractVideoUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const content = record.content as Record<string, unknown> | undefined;
  const videoUrl = content?.video_url;
  if (typeof videoUrl === "string") return videoUrl;
  if (videoUrl && typeof videoUrl === "object") {
    const url = (videoUrl as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  const output = record.output as Record<string, unknown> | undefined;
  if (typeof output?.video_url === "string") return output.video_url;
  return null;
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

async function persistVideoIfConfigured(
  env: WorkerEnv,
  jobId: string,
  videoUrl: string | null
): Promise<string | null> {
  const bucket = env.VIDEO_ASSETS as R2LikeBucket | undefined;
  if (!bucket || !videoUrl) return videoUrl;

  const response = await fetch(videoUrl);
  if (!response.ok) return videoUrl;

  const key = `byteplus/${jobId}.mp4`;
  await bucket.put(key, response.body, {
    httpMetadata: {
      contentType: response.headers.get("content-type") || "video/mp4",
    },
  });
  return key;
}

export function bytePlusAvailable(env: WorkerEnv): boolean {
  return Boolean(apiKey(env));
}

export async function dispatchToBytePlus(
  env: WorkerEnv,
  job: JobRow
): Promise<JobRow> {
  const response = await arkFetch(env, "/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(taskPayload(job.prompt, job.settings)),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `failed to create BytePlus Seedance task: ${response.status} ${
        extractError(payload) || ""
      }`.trim()
    );
  }

  const backendTaskId = extractTaskId(payload);
  if (!backendTaskId) {
    throw new Error("BytePlus response did not include a task id");
  }

  return {
    ...job,
    backend_provider: "byteplus",
    backend_task_id: backendTaskId,
    status: "running",
    current_step: "rendering_video",
    progress: 20,
    timeline: [
      ...job.timeline,
      createTimelineEntry(
        "rendering_video",
        "running",
        `Task Seedance criada no ModelArk: ${backendTaskId}.`
      ),
    ],
    updated_at: new Date().toISOString(),
  };
}

export async function syncFromBytePlus(
  env: WorkerEnv,
  job: JobRow
): Promise<JobRow> {
  if (!job.backend_task_id) return job;

  const response = await arkFetch(
    env,
    `/contents/generations/tasks/${encodeURIComponent(job.backend_task_id)}`,
    { method: "GET" }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ...job,
      error: extractError(payload) || `BytePlus status error: ${response.status}`,
      updated_at: new Date().toISOString(),
    };
  }

  const status = String((payload as Record<string, unknown>).status || "").toLowerCase();
  if (status === "succeeded") {
    const videoUrl = extractVideoUrl(payload);
    const videoKey = await persistVideoIfConfigured(env, job.id, videoUrl);
    await insertMediaAsset(env, {
      id: `video-${job.id}`,
      user_id: job.user_id || null,
      type: "video",
      provider: "byteplus",
      title: job.prompt,
      prompt: job.prompt,
      asset_key: videoKey && videoKey !== videoUrl ? videoKey : null,
      asset_url: videoKey || videoUrl,
      duration: clampDuration(job.settings.duration),
      metadata: {
        job_id: job.id,
        backend_task_id: job.backend_task_id,
        resolution: normalizeResolution(job.settings.resolution),
        ratio: normalizeRatio(job.settings.ratio),
      },
    }).catch(() => null);
    return {
      ...job,
      status: "done",
      current_step: "done",
      progress: 100,
      video_key: videoKey || job.video_key,
      asset_manifest: {
        ...job.asset_manifest,
        byteplus_status: status,
        byteplus_raw_video_url: videoUrl,
        byteplus_persisted_to_r2: Boolean(videoKey && videoKey !== videoUrl),
      },
      updated_at: new Date().toISOString(),
    };
  }

  if (["failed", "expired", "cancelled"].includes(status)) {
    return {
      ...job,
      status: "failed",
      progress: Math.max(job.progress, 80),
      error: extractError(payload) || `BytePlus task ended with status: ${status}`,
      updated_at: new Date().toISOString(),
    };
  }

  return {
    ...job,
    status: "running",
    current_step: "rendering_video",
    progress: Math.max(job.progress, status === "running" ? 60 : 35),
    asset_manifest: {
      ...job.asset_manifest,
      byteplus_status: status || "queued",
    },
    updated_at: new Date().toISOString(),
  };
}
