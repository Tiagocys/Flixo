import {
  createTimelineEntry,
  normalizeJobStatus,
  normalizeJobStep,
  type WorkerEnv,
} from "../../_lib/types";
import { syncFromBackend } from "../../_lib/moneyprinter";
import { syncFromBytePlus } from "../../_lib/byteplus";
import { requireCurrentUser } from "../../_lib/auth";
import { getJob, patchJob, type JobRow } from "../../_lib/supabase";

function jsonError(message: string, status = 404) {
  return Response.json({ error: message, message }, { status });
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

function toJobResponse(job: JobRow, env: WorkerEnv) {
  return {
    ...job,
    video_url: buildVideoUrl(env, job.video_key),
  };
}

export async function onRequestGet({
  request,
  params,
  env,
}: {
  request: Request;
  params: { id: string };
  env: WorkerEnv;
}) {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;

  const job = await getJob(env, params.id, user.id);
  if (!job) {
    return jsonError("job not found", 404);
  }

  const url = new URL(request.url);
  if (url.searchParams.get("refresh") === "1") {
    try {
      const synced =
        job.backend_provider === "byteplus"
          ? await syncFromBytePlus(env, job)
          : await syncFromBackend(env, job);
      if (synced !== job) {
        const saved = await patchJob(env, job.id, { ...synced, user_id: user.id });
        return Response.json({ job: toJobResponse(saved, env) });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to refresh job status";
      return Response.json({
        job: toJobResponse(job, env),
        warning: message,
      });
    }
  }

  return Response.json({ job: toJobResponse(job, env) });
}

export async function onRequestPatch({
  request,
  params,
  env,
}: {
  request: Request;
  params: { id: string };
  env: WorkerEnv;
}) {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const existing = await getJob(env, params.id, user.id);
  if (!existing) {
    return jsonError("job not found", 404);
  }

  const next = await patchJob(env, params.id, {
    user_id: user.id,
    status:
      payload && typeof payload === "object" && "status" in payload
        ? normalizeJobStatus((payload as Record<string, unknown>).status)
        : existing.status,
    current_step:
      payload && typeof payload === "object" && "current_step" in payload
        ? normalizeJobStep((payload as Record<string, unknown>).current_step)
        : existing.current_step,
    progress:
      payload && typeof payload === "object" && "progress" in payload
        ? Number((payload as Record<string, unknown>).progress)
        : existing.progress,
    error:
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as Record<string, unknown>).error || "")
        : existing.error,
    timelineEntry:
      payload && typeof payload === "object" && "message" in payload
        ? createTimelineEntry(
            existing.current_step,
            existing.status,
            String((payload as Record<string, unknown>).message || "")
          )
        : undefined,
  });

  return Response.json({ job: toJobResponse(next, env) });
}
