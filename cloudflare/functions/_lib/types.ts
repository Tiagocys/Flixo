export type JobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "waiting";

export type JobStep =
  | "queued"
  | "writing_script"
  | "generating_voice"
  | "collecting_assets"
  | "syncing_captions"
  | "rendering_video"
  | "done";

export interface PipelineStep {
  key: JobStep;
  label: string;
  description: string;
}

export interface JobTimelineEntry {
  at: string;
  status: JobStatus;
  step: JobStep;
  message: string;
}

export interface JobSettings {
  aspect?: "portrait" | "landscape" | "square";
  model?: string;
  provider?: "moneyprinter" | "byteplus" | string;
  tts?: "edge" | "elevenlabs" | string;
  source?: string;
  language?: string;
  voice?: string;
  duration?: number;
  resolution?: string;
  ratio?: string;
  imageUrl?: string;
  imageDataUrl?: string;
  cameraFixed?: boolean;
  [key: string]: unknown;
}

export interface WorkerEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  SUPABASE_URL?: string;
  SUPABASE_PROJECT_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SCHEMA?: string;
  SUPABASE_TABLE?: string;
  MONEYPRINTER_API_URL?: string;
  MONEYPRINTER_API_TOKEN?: string;
  BYTEPLUS_APIKEY?: string;
  BYTEPLUS_API_KEY?: string;
  ARK_API_KEY?: string;
  BYTEPLUS_API_BASE?: string;
  PEXELS_APIKEY?: string;
  PEXELS_API_KEY?: string;
  PIXABAY_APIKEY?: string;
  PIXABAY_API_KEY?: string;
  ELEVENLABS_APIKEY?: string;
  ELEVENLABS_API_KEY?: string;
  MEDIA_ASSETS_TABLE?: string;
  R2_BUCKET?: string;
  R2_BUCKET_TOKEN?: string;
  R2_BUCKET_ACCESS_KEY_ID?: string;
  R2_BUCKET_SECRET_ACCESS_KEY?: string;
  R2_PUBLIC_BASE_URL?: string;
  VIDEO_ASSETS?: unknown;
  [key: string]: unknown;
}

export interface JobRow {
  id: string;
  user_id?: string | null;
  prompt: string;
  settings: JobSettings;
  status: JobStatus;
  current_step: JobStep;
  progress: number;
  backend_provider: string;
  backend_task_id: string | null;
  script: string | null;
  narration_key: string | null;
  subtitles_key: string | null;
  video_key: string | null;
  asset_manifest: Record<string, unknown>;
  timeline: JobTimelineEntry[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type MediaAssetType = "video" | "audio";

export interface MediaAssetRow {
  id: string;
  user_id?: string | null;
  type: MediaAssetType;
  provider: string;
  title: string;
  prompt: string | null;
  asset_key: string | null;
  asset_url: string | null;
  duration: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface JobsListResponse {
  jobs: Array<ReturnType<typeof toClientJob>>;
  total: number;
}

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    key: "queued",
    label: "Fila recebida",
    description: "O prompt entra no sistema e recebe um identificador.",
  },
  {
    key: "writing_script",
    label: "Roteiro",
    description: "O LLM transforma o tema em uma estrutura narrativa curta.",
  },
  {
    key: "generating_voice",
    label: "Narração",
    description: "O texto segue para TTS e vira áudio sincronizável.",
  },
  {
    key: "collecting_assets",
    label: "Mídia",
    description: "O Worker localiza fotos e vídeos em bancos externos.",
  },
  {
    key: "syncing_captions",
    label: "Legendas",
    description: "Whisper alinha os trechos da fala com o texto.",
  },
  {
    key: "rendering_video",
    label: "Renderização",
    description: "FFmpeg compõe o MP4 final e publica o artefato.",
  },
  {
    key: "done",
    label: "MP4 pronto",
    description: "O vídeo final fica armazenado no R2 ou em URL pública.",
  },
];

export function createTimelineEntry(
  step: JobStep,
  status: JobStatus,
  message: string
): JobTimelineEntry {
  return {
    at: new Date().toISOString(),
    status,
    step,
    message,
  };
}

export function createJobId(): string {
  return crypto.randomUUID();
}

export function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

export function clampProgress(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function normalizeJobStatus(value: unknown): JobStatus {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "queued" || normalized === "running") {
    return normalized;
  }
  if (normalized === "done" || normalized === "completed" || normalized === "complete") {
    return "done";
  }
  if (normalized === "failed" || normalized === "error") {
    return "failed";
  }
  if (normalized === "waiting") {
    return "waiting";
  }
  return "queued";
}

export function normalizeJobStep(value: unknown): JobStep {
  const normalized = String(value || "").toLowerCase();
  if (
    normalized === "writing_script" ||
    normalized === "generating_voice" ||
    normalized === "collecting_assets" ||
    normalized === "syncing_captions" ||
    normalized === "rendering_video" ||
    normalized === "done"
  ) {
    return normalized;
  }
  return "queued";
}

export function toClientJob(row: JobRow) {
  const timeline = Array.isArray(row.timeline) ? row.timeline : [];
  const latest = timeline[timeline.length - 1];
  return {
    id: row.id,
    prompt: row.prompt,
    settings: row.settings || {},
    status: row.status,
    current_step: row.current_step,
    progress: row.progress,
    backend_provider: row.backend_provider,
    backend_task_id: row.backend_task_id,
    script: row.script,
    narration_key: row.narration_key,
    subtitles_key: row.subtitles_key,
    video_key: row.video_key,
    video_url: row.video_key,
    asset_manifest: row.asset_manifest || {},
    timeline,
    latest_event: latest || null,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mergeTimeline(
  timeline: JobTimelineEntry[] | undefined,
  entry: JobTimelineEntry
): JobTimelineEntry[] {
  const next = Array.isArray(timeline) ? timeline.slice() : [];
  next.push(entry);
  return next;
}
