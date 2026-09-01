import {
  createTimelineEntry,
  type JobRow,
  type JobSettings,
  type WorkerEnv,
} from "./types";
import { insertMediaAsset } from "./supabase";
import { elevenLabsVoiceNameForProfile } from "./elevenlabs";
import { geminiVoiceNameForProfile } from "./gemini";
import { putR2Object } from "./r2";

const DEFAULT_ELEVENLABS_VOICE = "elevenlabs:hpp4J3VqNfWAUOO0d1Us:Bella";

function hasBackend(env: WorkerEnv): boolean {
  return Boolean(env.MONEYPRINTER_API_URL);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function apiV1Url(env: WorkerEnv, path: string): string {
  return `${normalizeBaseUrl(env.MONEYPRINTER_API_URL || "")}/api/v1${path}`;
}

function assetUrlFromKey(key: string): string {
  return `/api/assets?key=${encodeURIComponent(key)}`;
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || "";
}

function backendAssetUrl(env: WorkerEnv, job: JobRow, assetPath: string | null): string | null {
  if (!assetPath) return null;
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  if (!env.MONEYPRINTER_API_URL) return null;

  const base = normalizeBaseUrl(env.MONEYPRINTER_API_URL);
  if (assetPath.startsWith("/tasks/")) {
    return `${base}${assetPath}`;
  }

  const fileName = basename(assetPath);
  if (job.backend_task_id && fileName) {
    return `${base}/tasks/${encodeURIComponent(job.backend_task_id)}/${encodeURIComponent(fileName)}`;
  }

  return null;
}

async function persistBackendVideoIfConfigured(
  env: WorkerEnv,
  job: JobRow,
  videoPath: string | null
): Promise<{ videoKey: string | null; videoUrl: string | null; persisted: boolean }> {
  if (!videoPath) return { videoKey: null, videoUrl: null, persisted: false };
  if (videoPath.startsWith("moneyprinter/")) {
    return { videoKey: videoPath, videoUrl: assetUrlFromKey(videoPath), persisted: true };
  }

  const videoUrl = backendAssetUrl(env, job, videoPath) || videoPath;
  const response = await fetch(videoUrl).catch(() => null);
  if (!response?.ok || !response.body) {
    return { videoKey: videoPath, videoUrl, persisted: false };
  }

  const key = `moneyprinter/${job.id}/final.mp4`;
  const body = await response.arrayBuffer();
  const persisted = await putR2Object(
    env,
    key,
    body,
    response.headers.get("content-type") || "video/mp4"
  );
  if (!persisted) {
    return { videoKey: videoPath, videoUrl, persisted: false };
  }

  return { videoKey: key, videoUrl: assetUrlFromKey(key), persisted: true };
}

async function recoverCompletedTaskFromStaticFiles(
  env: WorkerEnv,
  job: JobRow
): Promise<JobRow | null> {
  if (!job.backend_task_id || !env.MONEYPRINTER_API_URL) return null;

  const finalPath = `/tasks/${job.backend_task_id}/final-1.mp4`;
  const finalUrl = `${normalizeBaseUrl(env.MONEYPRINTER_API_URL)}${finalPath}`;
  const head = await fetch(finalUrl, { method: "HEAD" }).catch(() => null);
  if (!head?.ok) return null;

  const persisted = await persistBackendVideoIfConfigured(env, job, finalPath);
  const scriptResponse = await fetch(
    `${normalizeBaseUrl(env.MONEYPRINTER_API_URL)}/tasks/${job.backend_task_id}/script.json`
  ).catch(() => null);
  const scriptPayload = scriptResponse?.ok
    ? ((await scriptResponse.json().catch(() => null)) as Record<string, unknown> | null)
    : null;
  const recoveredScript =
    typeof scriptPayload?.script === "string" ? scriptPayload.script : job.script;

  await insertMediaAsset(env, {
    id: `video-${job.id}`,
    user_id: job.user_id || null,
    type: "video",
    provider: "moneyprinterturbo",
    title: job.prompt,
    prompt: job.prompt,
    asset_key: persisted.persisted ? persisted.videoKey : null,
    asset_url: persisted.videoUrl,
    duration: null,
    metadata: {
      job_id: job.id,
      backend_task_id: job.backend_task_id,
      recovered_from_static_files: true,
      persisted_to_r2: persisted.persisted,
      music_disabled: true,
    },
  }).catch(() => null);

  return {
    ...job,
    status: "done",
    current_step: "done",
    progress: 100,
    script: recoveredScript,
    video_key: persisted.videoKey || finalPath,
    subtitles_key: `/tasks/${job.backend_task_id}/subtitle.srt`,
    narration_key: `/tasks/${job.backend_task_id}/audio.mp3`,
    error: null,
    timeline: [
      ...job.timeline,
      createTimelineEntry(
        "done",
        "done",
        persisted.persisted
          ? "Vídeo final recuperado do backend e salvo no R2."
          : "Vídeo final recuperado do backend local."
      ),
    ],
    updated_at: new Date().toISOString(),
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function subtitlePosition(value: unknown): string {
  const normalized = String(value || "bottom");
  return ["top", "center", "bottom"].includes(normalized) ? normalized : "bottom";
}

function subtitleStrokeColor(value: unknown): string {
  const normalized = String(value || "#000000");
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "#000000";
}

function subtitleTextColor(value: unknown): string {
  const normalized = String(value || "#FFFFFF");
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "#FFFFFF";
}

function subtitleStyle(value: unknown): string {
  const normalized = String(value || "standard").toLowerCase();
  return normalized === "word" ? "word" : "standard";
}

function mediaMode(value: unknown): string {
  const normalized = String(value || "videos");
  return ["videos", "images", "mixed"].includes(normalized) ? normalized : "videos";
}

function mediaStyle(value: unknown): string {
  const normalized = String(value || "all");
  return ["all", "realistic", "animation"].includes(normalized) ? normalized : "all";
}

function mediaSource(settings: JobSettings): string {
  if (selectedMedia(settings).length) return "local";
  const source = String(settings.source || "auto");
  if (source === "pexels" || source === "pixabay" || source === "coverr") {
    return source;
  }
  const mode = mediaMode(settings.mediaMode);
  const style = mediaStyle(settings.mediaStyle);
  if (mode === "images" || style === "animation") {
    return "pixabay";
  }
  return "pexels";
}

function selectedMedia(settings: JobSettings): Array<Record<string, unknown>> {
  return Array.isArray(settings.selectedMedia)
    ? (settings.selectedMedia as Array<Record<string, unknown>>)
    : [];
}

function mediaMaterialUrl(asset: Record<string, unknown>): string {
  return String(asset.videoUrl || asset.imageUrl || asset.url || asset.assetUrl || "").trim();
}

function selectedVideoMaterials(settings: JobSettings) {
  return selectedMedia(settings)
    .map((asset) => ({
      provider: String(asset.provider || "selected"),
      url: mediaMaterialUrl(asset),
      duration: Math.max(0, Math.round(Number(asset.duration || 0))),
    }))
    .filter((asset) => asset.url);
}

function aspectLabel(value: unknown): string {
  if (value === "landscape") return "horizontal";
  if (value === "square") return "quadrado";
  return "vertical";
}

function englishAspectLabel(value: unknown): string {
  if (value === "landscape") return "horizontal";
  if (value === "square") return "square";
  return "vertical";
}

function scriptPrompt(maxNarrationSeconds: number, aspect: unknown, language: unknown): string {
  const locale = String(language || "").toLowerCase();
  if (locale.startsWith("en")) {
    return `Create an English script for a short ${englishAspectLabel(aspect)} video, with at most ${maxNarrationSeconds} seconds of narration. Use short, direct sentences that are easy to caption. Do not include titles, scene markers, emojis, or technical instructions.`;
  }
  return `Crie um roteiro em português do Brasil para um vídeo ${aspectLabel(aspect)} curto, com no máximo ${maxNarrationSeconds} segundos de narração. Use frases curtas, diretas e fáceis de legendar. Não inclua títulos, marcações de cena, emojis ou instruções técnicas.`;
}

function composeTaskPayload(prompt: string, settings: JobSettings = {}) {
  const voiceName =
    settings.tts === "elevenlabs"
      ? settings.voice || elevenLabsVoiceNameForProfile(settings.voiceProfile)
      : settings.tts === "gemini"
        ? settings.voice || geminiVoiceNameForProfile(settings.voiceProfile)
      : settings.voice || "pt-BR-FranciscaNeural-Female";
  const maxNarrationSeconds = clampNumber(settings.maxNarrationSeconds, 30, 10, 60);
  const clipDuration = clampNumber(settings.videoClipDuration, 5, 2, 8);
  const fontSize = clampNumber(settings.subtitleFontSize, 60, 24, 96);
  const strokeWidth = clampNumber(settings.subtitleStrokeWidth, 2, 0, 6);
  const selectedMaterials = selectedVideoMaterials(settings);

  return {
    video_subject: prompt,
    video_script: "",
    video_terms: null,
    video_aspect:
      settings.aspect === "landscape"
        ? "16:9"
        : settings.aspect === "square"
          ? "1:1"
          : "9:16",
    video_concat_mode: selectedMaterials.length ? "sequential" : "random",
    video_transition_mode: null,
    video_clip_duration: clipDuration,
    video_clip_speed: 1,
    match_materials_to_script: true,
    video_count: 1,
    video_source: mediaSource(settings),
    video_materials: selectedMaterials.length ? selectedMaterials : null,
    media_mode: mediaMode(settings.mediaMode),
    media_style: mediaStyle(settings.mediaStyle),
    custom_audio_file: null,
    video_language: settings.language || "",
    voice_name: voiceName,
    voice_volume: 1,
    voice_rate: 1,
    bgm_type: "",
    bgm_file: "",
    bgm_volume: 0,
    video_music_prompt: "",
    sonilo_bgm_prompt: "",
    subtitle_enabled: settings.subtitleEnabled !== false,
    subtitle_style: subtitleStyle(settings.subtitleStyle),
    subtitle_position: subtitlePosition(settings.subtitlePosition),
    custom_position: 70,
    font_name: "STHeitiMedium.ttc",
    text_fore_color: subtitleTextColor(settings.subtitleTextColor),
    text_background_color: false,
    rounded_subtitle_background: false,
    font_size: fontSize,
    stroke_color: subtitleStrokeColor(settings.subtitleStrokeColor),
    stroke_width: strokeWidth,
    n_threads: 2,
    paragraph_number: 1,
    video_script_prompt: scriptPrompt(maxNarrationSeconds, settings.aspect, settings.language),
    custom_system_prompt: "",
  };
}

export function backendAvailable(env: WorkerEnv): boolean {
  return hasBackend(env);
}

export async function dispatchToBackend(
  env: WorkerEnv,
  job: JobRow
): Promise<JobRow> {
  if (!hasBackend(env)) {
    return job;
  }

  let response: Response;
  try {
    response = await fetch(apiV1Url(env, "/videos"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.MONEYPRINTER_API_TOKEN
          ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(composeTaskPayload(job.prompt, job.settings)),
    });
  } catch (error) {
    const backendUrl = normalizeBaseUrl(env.MONEYPRINTER_API_URL || "");
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `MoneyPrinterTurbo backend is not reachable at ${backendUrl}. Start it with ".venv/bin/python main.py". Detail: ${detail}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `failed to dispatch backend job: ${response.status} ${body}`.trim()
    );
  }

  const payload = (await response.json()) as {
    data?: { task_id?: string };
    task_id?: string;
  };
  const backendTaskId = payload.data?.task_id || payload.task_id || null;

  return {
    ...job,
    backend_task_id: backendTaskId,
    status: "running",
    current_step: "writing_script",
    progress: 10,
    timeline: [
      ...job.timeline,
      createTimelineEntry(
        "writing_script",
        "running",
        "Backend acionado para gerar roteiro e vídeo."
      ),
    ],
    updated_at: new Date().toISOString(),
  };
}

export async function syncFromBackend(
  env: WorkerEnv,
  job: JobRow
): Promise<JobRow> {
  if (!hasBackend(env) || !job.backend_task_id) {
    return job;
  }

  const response = await fetch(
    apiV1Url(env, `/tasks/${encodeURIComponent(job.backend_task_id)}`),
    {
      headers: {
        ...(env.MONEYPRINTER_API_TOKEN
          ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
          : {}),
      },
    }
  );
  if (!response.ok) {
    if (response.status === 404) {
      const recovered = await recoverCompletedTaskFromStaticFiles(env, job);
      if (recovered) return recovered;
    }
    return job;
  }

  const payload = (await response.json()) as {
    data?: {
      state?: number;
      progress?: number;
      error?: string;
      failed_stage?: string;
      video_subject?: string;
      video_script?: string;
      script?: string;
      videos?: string[];
      combined_videos?: string[];
      materials?: string[];
      subtitles?: string[];
      audio?: string;
      audio_file?: string;
      subtitle_path?: string;
    };
  };
  const data = payload.data || {};
  const progress = typeof data.progress === "number" ? data.progress : job.progress;
  const state = data.state;

  let nextStatus = job.status;
  let nextStep = job.current_step;
  if (state === 1 || data.videos?.length) {
    nextStatus = "done";
    nextStep = "done";
  } else if (state === -1 || data.error) {
    nextStatus = "failed";
  } else if (progress > 0) {
    nextStatus = "running";
    if (progress >= 80) nextStep = "rendering_video";
    else if (progress >= 60) nextStep = "syncing_captions";
    else if (progress >= 40) nextStep = "collecting_assets";
    else if (progress >= 20) nextStep = "generating_voice";
    else nextStep = "writing_script";
  }

  const rawVideoKey = data.videos?.[0] || job.video_key;
  const persistedVideo =
    nextStatus === "done"
      ? await persistBackendVideoIfConfigured(env, job, rawVideoKey)
      : { videoKey: rawVideoKey, videoUrl: rawVideoKey, persisted: false };
  const nextVideoKey = persistedVideo.videoKey || rawVideoKey;
  const nextSubtitlesKey = data.subtitles?.[0] || data.subtitle_path || job.subtitles_key;
  const nextNarrationKey = data.audio || data.audio_file || job.narration_key;
  const nextScript = data.video_script || data.script || job.script;
  const nextError = nextStatus === "done" ? null : data.error || job.error;
  const nextAssetManifest = {
    ...(job.asset_manifest || {}),
    ...(Array.isArray(data.materials) ? { materials: data.materials } : {}),
    ...(Array.isArray(data.combined_videos)
      ? { combined_videos: data.combined_videos }
      : {}),
    ...(nextVideoKey ? { final_video: nextVideoKey } : {}),
  };
  const assetManifestChanged =
    JSON.stringify(nextAssetManifest) !== JSON.stringify(job.asset_manifest || {});

  const unchanged =
    nextStatus === job.status &&
    nextStep === job.current_step &&
    Math.max(job.progress, progress || 0) === job.progress &&
    nextVideoKey === job.video_key &&
    nextSubtitlesKey === job.subtitles_key &&
    nextNarrationKey === job.narration_key &&
    nextScript === job.script &&
    nextError === job.error &&
    !assetManifestChanged;

  if (unchanged) {
    return job;
  }

  if (nextStatus === "done" && nextVideoKey) {
    await insertMediaAsset(env, {
      id: `video-${job.id}`,
      user_id: job.user_id || null,
      type: "video",
      provider: "moneyprinterturbo",
      title: job.prompt,
      prompt: job.prompt,
      asset_key: persistedVideo.persisted ? nextVideoKey : null,
      asset_url: persistedVideo.videoUrl,
      duration: null,
      metadata: {
        job_id: job.id,
        backend_task_id: job.backend_task_id,
        has_narration: Boolean(nextNarrationKey),
        has_subtitles: Boolean(nextSubtitlesKey),
        persisted_to_r2: persistedVideo.persisted,
        music_disabled: true,
      },
    }).catch(() => null);
  }

  return {
    ...job,
    status: nextStatus,
    current_step: nextStep,
    progress: Math.max(job.progress, progress || 0),
    script: nextScript,
    video_key: nextVideoKey,
    subtitles_key: nextSubtitlesKey,
    narration_key: nextNarrationKey,
    asset_manifest: nextAssetManifest,
    error: nextError,
    timeline:
      nextStatus === "done" && job.status !== "done"
        ? [
            ...job.timeline,
            createTimelineEntry(
              "done",
              "done",
              persistedVideo.persisted
                ? "Vídeo final salvo no R2."
                : "Vídeo final disponível no backend local."
            ),
          ]
        : job.timeline,
    updated_at: new Date().toISOString(),
  };
}
