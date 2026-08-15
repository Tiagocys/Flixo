import {
  createJobId,
  createTimelineEntry,
  normalizeText,
  type WorkerEnv,
  type JobSettings,
} from "../_lib/types";
import { dispatchToBackend } from "../_lib/moneyprinter";
import { dispatchToBytePlus } from "../_lib/byteplus";
import { requireCurrentUser } from "../_lib/auth";
import {
  insertJob,
  listJobs,
  patchJob,
  type JobRow as SupabaseJobRow,
} from "../_lib/supabase";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message, message }, { status });
}

function parseSettings(input: unknown): JobSettings {
  if (!input || typeof input !== "object") return {};
  return input as JobSettings;
}

function sanitizeSettings(settings: JobSettings): JobSettings {
  const { imageDataUrl, ...safeSettings } = settings;
  if (safeSettings.provider === "byteplus") {
    delete safeSettings.model;
  }
  return {
    ...safeSettings,
    imageProvided: Boolean(imageDataUrl || settings.imageUrl),
  };
}

function buildVideoUrl(env: WorkerEnv, videoKey: string | null) {
  if (!videoKey) return null;
  if (/^https?:\/\//i.test(videoKey)) return videoKey;
  if (videoKey.startsWith("/tasks/") && env.MONEYPRINTER_API_URL) {
    return `${String(env.MONEYPRINTER_API_URL).replace(/\/+$/, "")}${videoKey}`;
  }
  const base = String(env.R2_PUBLIC_BASE_URL || "").trim();
  if (!base) return `/api/assets?key=${encodeURIComponent(videoKey)}`;
  return `${base.replace(/\/+$/, "")}/${videoKey.replace(/^\/+/, "")}`;
}

function toJobResponse(job: SupabaseJobRow, env: WorkerEnv) {
  return {
    job: {
      id: job.id,
      prompt: job.prompt,
      settings: job.settings,
      status: job.status,
      current_step: job.current_step,
      progress: job.progress,
      backend_provider: job.backend_provider,
      backend_task_id: job.backend_task_id,
      script: job.script,
      narration_key: job.narration_key,
      subtitles_key: job.subtitles_key,
      video_key: job.video_key,
      video_url: buildVideoUrl(env, job.video_key),
      asset_manifest: job.asset_manifest,
      timeline: job.timeline,
      error: job.error,
      created_at: job.created_at,
      updated_at: job.updated_at,
    },
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
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit") || "8"))
  );
  const jobs = await listJobs(env, limit, user.id);
  return Response.json({
    jobs: jobs.map((job) => toJobResponse(job, env).job),
    total: jobs.length,
  });
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

  const prompt = normalizeText(
    payload && typeof payload === "object" ? (payload as Record<string, unknown>).prompt : ""
  );
  if (!prompt) {
    return jsonError("prompt is required");
  }
  if (prompt.length > 1200) {
    return jsonError("prompt is too long");
  }

  const settings = parseSettings(
    payload && typeof payload === "object" ? (payload as Record<string, unknown>).settings : {}
  );
  const storedSettings = sanitizeSettings(settings);
  const provider = settings.provider === "byteplus" ? "byteplus" : "moneyprinterturbo";
  const now = new Date().toISOString();
  const jobId = createJobId();
  const initialJob = await insertJob(env, {
    id: jobId,
    user_id: user.id,
    prompt,
    settings: storedSettings,
    status: "queued",
    current_step: "queued",
    progress: 0,
    backend_provider: provider,
    backend_task_id: null,
    script: null,
    narration_key: null,
    subtitles_key: null,
    video_key: null,
    asset_manifest: {},
    timeline: [
      createTimelineEntry(
        "queued",
        "queued",
        "Prompt recebido e aguardando início do fluxo."
      ),
    ],
    error: null,
    created_at: now,
    updated_at: now,
  });

  let job = initialJob;
  try {
    const dispatchJob = { ...initialJob, settings };
    job =
      provider === "byteplus"
        ? await dispatchToBytePlus(env, dispatchJob)
        : await dispatchToBackend(env, dispatchJob);
    job = await patchJob(env, job.id, {
      user_id: user.id,
      status: job.status,
      current_step: job.current_step,
      progress: job.progress,
      backend_provider: job.backend_provider,
      backend_task_id: job.backend_task_id,
      script: job.script || null,
      narration_key: job.narration_key || null,
      subtitles_key: job.subtitles_key || null,
      video_key: job.video_key || null,
      timelineEntry: createTimelineEntry(
        job.current_step,
        job.status,
        job.backend_task_id
          ? `Job enviado ao backend externo: ${job.backend_task_id}.`
          : "Job criado localmente; backend externo não configurado."
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to create job";
    job = await patchJob(env, initialJob.id, {
      user_id: user.id,
      status: "failed",
      current_step: "queued",
      progress: 0,
      error: message,
      timelineEntry: createTimelineEntry("queued", "failed", message),
    });
  }

  return Response.json(toJobResponse(job, env));
}
