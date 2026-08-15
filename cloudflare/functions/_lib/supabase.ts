import {
  clampProgress,
  createTimelineEntry,
  mergeTimeline,
  normalizeJobStatus,
  normalizeJobStep,
  normalizeText,
  type JobRow,
  type JobSettings,
  type JobStatus,
  type JobStep,
  type MediaAssetRow,
  type WorkerEnv,
} from "./types";

export type { JobRow } from "./types";

const memoryStore = (globalThis as unknown as {
  __mptJobs?: Map<string, JobRow>;
}).__mptJobs ?? new Map<string, JobRow>();
const mediaMemoryStore = (globalThis as unknown as {
  __mptMediaAssets?: Map<string, MediaAssetRow>;
}).__mptMediaAssets ?? new Map<string, MediaAssetRow>();

if (!(globalThis as unknown as { __mptJobs?: Map<string, JobRow> }).__mptJobs) {
  (globalThis as unknown as { __mptJobs: Map<string, JobRow> }).__mptJobs = memoryStore;
}
if (
  !(globalThis as unknown as { __mptMediaAssets?: Map<string, MediaAssetRow> })
    .__mptMediaAssets
) {
  (globalThis as unknown as { __mptMediaAssets: Map<string, MediaAssetRow> })
    .__mptMediaAssets = mediaMemoryStore;
}

function isSupabaseConfigured(env: WorkerEnv): boolean {
  return Boolean((env.SUPABASE_URL || env.SUPABASE_PROJECT_URL) && env.SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseHeaders(env: WorkerEnv): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("apikey", env.SUPABASE_SERVICE_ROLE_KEY || "");
  headers.set("Authorization", `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ""}`);
  headers.set("Prefer", "return=representation");
  headers.set("Accept-Profile", env.SUPABASE_SCHEMA || "public");
  headers.set("Content-Profile", env.SUPABASE_SCHEMA || "public");
  return headers;
}

async function supabaseFetch(
  env: WorkerEnv,
  path: string,
  init: RequestInit
): Promise<Response> {
  const baseUrl = String(env.SUPABASE_URL || env.SUPABASE_PROJECT_URL || "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("SUPABASE_URL is not configured");
  }
  return fetch(`${baseUrl}/rest/v1/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: supabaseHeaders(env),
  });
}

function tableName(env: WorkerEnv): string {
  return env.SUPABASE_TABLE || "video_jobs";
}

function mediaAssetsTableName(env: WorkerEnv): string {
  return env.MEDIA_ASSETS_TABLE || "media_assets";
}

function memoryUpsert(job: JobRow): JobRow {
  memoryStore.set(job.id, job);
  return job;
}

function memorySelect(limit: number, userId?: string): JobRow[] {
  return Array.from(memoryStore.values())
    .filter((job) => !userId || job.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

function memoryFind(id: string, userId?: string): JobRow | null {
  const job = memoryStore.get(id) || null;
  if (!job || !userId) return job;
  return job.user_id === userId ? job : null;
}

function mediaMemoryUpsert(asset: MediaAssetRow): MediaAssetRow {
  mediaMemoryStore.set(asset.id, asset);
  return asset;
}

function mediaMemorySelect(limit: number, type?: string, userId?: string): MediaAssetRow[] {
  return Array.from(mediaMemoryStore.values())
    .filter((asset) => !type || asset.type === type)
    .filter((asset) => !userId || asset.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

export function supabaseAvailable(env: WorkerEnv): boolean {
  return isSupabaseConfigured(env);
}

export async function listJobs(env: WorkerEnv, limit = 8, userId?: string): Promise<JobRow[]> {
  if (!isSupabaseConfigured(env)) {
    return memorySelect(limit, userId);
  }

  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");
  params.set("limit", String(limit));
  if (userId) params.set("user_id", `eq.${userId}`);

  const response = await supabaseFetch(
    env,
    `${tableName(env)}?${params.toString()}`,
    { method: "GET" }
  );
  if (!response.ok) {
    throw new Error(`failed to list jobs: ${response.status}`);
  }
  return (await response.json()) as JobRow[];
}

export async function getJob(env: WorkerEnv, id: string, userId?: string): Promise<JobRow | null> {
  if (!isSupabaseConfigured(env)) {
    return memoryFind(id, userId);
  }

  const params = new URLSearchParams();
  params.set("id", `eq.${id}`);
  params.set("select", "*");
  if (userId) params.set("user_id", `eq.${userId}`);

  const response = await supabaseFetch(
    env,
    `${tableName(env)}?${params.toString()}`,
    { method: "GET" }
  );
  if (!response.ok) {
    throw new Error(`failed to fetch job: ${response.status}`);
  }
  const rows = (await response.json()) as JobRow[];
  return rows[0] || null;
}

export async function insertJob(
  env: WorkerEnv,
  job: Omit<JobRow, "created_at" | "updated_at"> & {
    created_at?: string;
    updated_at?: string;
  }
): Promise<JobRow> {
  const row: JobRow = {
    ...job,
    created_at: job.created_at || new Date().toISOString(),
    updated_at: job.updated_at || new Date().toISOString(),
  };

  if (!isSupabaseConfigured(env)) {
    return memoryUpsert(row);
  }

  const response = await supabaseFetch(env, tableName(env), {
    method: "POST",
    body: JSON.stringify(row),
  });
  if (!response.ok) {
    throw new Error(`failed to insert job: ${response.status}`);
  }
  const rows = (await response.json()) as JobRow[];
  return rows[0] || row;
}

export async function patchJob(
  env: WorkerEnv,
  id: string,
  patch: Partial<JobRow> & {
    status?: JobStatus;
    current_step?: JobStep;
    progress?: number;
    prompt?: string;
    settings?: JobSettings;
    error?: string | null;
    timelineEntry?: ReturnType<typeof createTimelineEntry>;
  }
): Promise<JobRow> {
  const { timelineEntry, ...jobPatch } = patch;
  const scopedUserId = patch.user_id || undefined;
  const existing = (await getJob(env, id, scopedUserId)) || null;
  if (!existing) {
    throw new Error(`job ${id} not found`);
  }

  const nextTimeline = timelineEntry
    ? mergeTimeline(existing.timeline, timelineEntry)
    : existing.timeline;
  const nextRow: JobRow = {
    ...existing,
    ...jobPatch,
    status: jobPatch.status || existing.status,
    current_step: jobPatch.current_step || existing.current_step,
    progress:
      typeof jobPatch.progress === "number"
        ? clampProgress(jobPatch.progress)
        : existing.progress,
    prompt: normalizeText(jobPatch.prompt, existing.prompt),
    settings: jobPatch.settings || existing.settings,
    error: jobPatch.error === undefined ? existing.error : jobPatch.error,
    timeline: nextTimeline,
    updated_at: new Date().toISOString(),
  };

  if (!isSupabaseConfigured(env)) {
    return memoryUpsert(nextRow);
  }

  const response = await supabaseFetch(
    env,
    `${tableName(env)}?id=eq.${encodeURIComponent(id)}${scopedUserId ? `&user_id=eq.${encodeURIComponent(scopedUserId)}` : ""}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...nextRow,
        timeline: nextRow.timeline,
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`failed to patch job: ${response.status}`);
  }
  const rows = (await response.json()) as JobRow[];
  const updated = rows[0] || nextRow;
  memoryUpsert(updated);
  return updated;
}

export async function upsertJobFromMemory(job: JobRow): Promise<JobRow> {
  return memoryUpsert(job);
}

export async function insertMediaAsset(
  env: WorkerEnv,
  asset: Omit<MediaAssetRow, "created_at"> & { created_at?: string }
): Promise<MediaAssetRow> {
  const row: MediaAssetRow = {
    ...asset,
    created_at: asset.created_at || new Date().toISOString(),
  };

  if (!isSupabaseConfigured(env)) {
    return mediaMemoryUpsert(row);
  }

  const response = await supabaseFetch(env, mediaAssetsTableName(env), {
    method: "POST",
    body: JSON.stringify(row),
  });
  if (!response.ok) {
    throw new Error(`failed to insert media asset: ${response.status}`);
  }
  const rows = (await response.json()) as MediaAssetRow[];
  const inserted = rows[0] || row;
  mediaMemoryUpsert(inserted);
  return inserted;
}

export async function listMediaAssets(
  env: WorkerEnv,
  options: { limit?: number; type?: string; userId?: string } = {}
): Promise<MediaAssetRow[]> {
  const limit = Math.min(50, Math.max(1, Number(options.limit || 12)));
  const type = options.type;
  const userId = options.userId;
  if (!isSupabaseConfigured(env)) {
    return mediaMemorySelect(limit, type, userId);
  }

  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");
  params.set("limit", String(limit));
  if (type) params.set("type", `eq.${type}`);
  if (userId) params.set("user_id", `eq.${userId}`);

  const response = await supabaseFetch(
    env,
    `${mediaAssetsTableName(env)}?${params.toString()}`,
    { method: "GET" }
  );
  if (!response.ok) {
    throw new Error(`failed to list media assets: ${response.status}`);
  }
  return (await response.json()) as MediaAssetRow[];
}

export function createLocalJob(
  id: string,
  prompt: string,
  settings: JobSettings,
  status: JobStatus,
  current_step: JobStep,
  progress: number,
  backend_provider: string,
  backend_task_id: string | null,
  timeline: ReturnType<typeof createTimelineEntry>[]
): JobRow {
  return {
    id,
    prompt,
    settings,
    status,
    current_step,
    progress,
    backend_provider,
    backend_task_id,
    script: null,
    narration_key: null,
    subtitles_key: null,
    video_key: null,
    asset_manifest: {},
    timeline,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
