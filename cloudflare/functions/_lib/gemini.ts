import type { WorkerEnv } from "./types";
import { insertMediaAsset } from "./supabase";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const MAX_TTS_CHARS = 1200;
const WAV_SAMPLE_RATE = 24000;
const WAV_CHANNELS = 1;
const WAV_SAMPLE_WIDTH = 2;

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

export interface GeminiVoiceProfile {
  id: string;
  label: string;
  voiceName: string;
  style: string;
  sample: string;
}

export const GEMINI_VOICE_PROFILES: GeminiVoiceProfile[] = [
  {
    id: "kore-firme",
    label: "Feminina - Firme",
    voiceName: "Kore",
    style: "Firme",
    sample: "Em poucos segundos, sua ideia pode virar uma narração clara e profissional.",
  },
  {
    id: "aoede-leve",
    label: "Feminina - Leve",
    voiceName: "Aoede",
    style: "Leve",
    sample: "Uma voz mais leve funciona bem para vídeos explicativos e conteúdos suaves.",
  },
  {
    id: "puck-animada",
    label: "Masculina - Animada",
    voiceName: "Puck",
    style: "Animada",
    sample: "Quando o vídeo precisa de energia, essa voz entrega mais ritmo.",
  },
  {
    id: "charon-informativa",
    label: "Masculina - Informativa",
    voiceName: "Charon",
    style: "Informativa",
    sample: "Essa é uma leitura direta, boa para curiosidades, notícias e explicações.",
  },
  {
    id: "leda-jovem",
    label: "Feminina - Jovem",
    voiceName: "Leda",
    style: "Jovem",
    sample: "Uma narração com tom jovem para clipes rápidos e chamadas de atenção.",
  },
  {
    id: "orus-forte",
    label: "Masculina - Forte",
    voiceName: "Orus",
    style: "Forte",
    sample: "Use uma voz mais forte quando a mensagem precisar soar decisiva.",
  },
  {
    id: "achird-amigavel",
    label: "Masculina - Amigável",
    voiceName: "Achird",
    style: "Amigável",
    sample: "Um tom próximo ajuda você a criar vídeos mais naturais e humanos.",
  },
  {
    id: "sulafat-quente",
    label: "Feminina - Quente",
    voiceName: "Sulafat",
    style: "Quente",
    sample: "Essa voz funciona bem quando você quer uma narração acolhedora.",
  },
];

function apiKey(env: WorkerEnv): string {
  return String(
    env.GEMINI_APIKEY ||
      env.GEMINI_API_KEY ||
      env.GOOGLE_APIKEY ||
      env.GOOGLE_API_KEY ||
      ""
  ).trim();
}

export function geminiTtsAvailable(env: WorkerEnv): boolean {
  return Boolean(apiKey(env));
}

export function geminiVoiceProfile(id: unknown): GeminiVoiceProfile {
  const selected = String(id || "");
  return (
    GEMINI_VOICE_PROFILES.find((profile) => profile.id === selected) ||
    GEMINI_VOICE_PROFILES[0]
  );
}

export function geminiVoiceNameForProfile(id: unknown): string {
  const profile = geminiVoiceProfile(id);
  return `gemini:${profile.voiceName}-Auto`;
}

function safePrompt(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_TTS_CHARS);
}

function approximateDuration(text: string): number {
  return Math.max(1, Math.round(text.length / 13));
}

function assetUrlFromKey(key: string): string {
  return `/api/assets?key=${encodeURIComponent(key)}`;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function pcmToWav(pcmBuffer: ArrayBuffer): ArrayBuffer {
  const wavBuffer = new ArrayBuffer(44 + pcmBuffer.byteLength);
  const view = new DataView(wavBuffer);
  const pcm = new Uint8Array(pcmBuffer);
  const output = new Uint8Array(wavBuffer);
  const byteRate = WAV_SAMPLE_RATE * WAV_CHANNELS * WAV_SAMPLE_WIDTH;
  const blockAlign = WAV_CHANNELS * WAV_SAMPLE_WIDTH;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBuffer.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, WAV_CHANNELS, true);
  view.setUint32(24, WAV_SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, WAV_SAMPLE_WIDTH * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcmBuffer.byteLength, true);
  output.set(pcm, 44);
  return wavBuffer;
}

function extractAudioBase64(payload: Record<string, unknown>): string {
  const direct = payload.output_audio;
  if (direct && typeof direct === "object") {
    const data = (direct as Record<string, unknown>).data;
    if (typeof data === "string") return data;
  }

  const interaction = payload.interaction;
  if (interaction && typeof interaction === "object") {
    const audio = (interaction as Record<string, unknown>).output_audio;
    if (audio && typeof audio === "object") {
      const data = (audio as Record<string, unknown>).data;
      if (typeof data === "string") return data;
    }
  }

  const candidates = payload.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const content = candidate?.content;
      const parts = content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const inlineData = part?.inlineData || part?.inline_data;
        const data = inlineData?.data;
        if (typeof data === "string") return data;
      }
    }
  }

  return "";
}

async function requestGeminiTts(
  env: WorkerEnv,
  text: string,
  voiceName: string
): Promise<ArrayBuffer> {
  const key = apiKey(env);
  if (!key) {
    throw new Error("Gemini TTS nao configurado.");
  }

  const model = String(env.GEMINI_TTS_MODEL || DEFAULT_TTS_MODEL).trim();
  const response = await fetch(`${GEMINI_BASE_URL}/interactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify({
      model,
      input: text,
      response_format: { type: "audio" },
      generation_config: {
        speech_config: [{ voice: voiceName }],
      },
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload.error === "object" && payload.error
        ? String((payload.error as Record<string, unknown>).message || response.statusText)
        : `Gemini TTS falhou: ${response.status}`;
    throw new Error(message);
  }

  const audioBase64 = extractAudioBase64(payload);
  if (!audioBase64) {
    throw new Error("Gemini TTS nao retornou audio.");
  }

  return pcmToWav(base64ToArrayBuffer(audioBase64));
}

export async function createGeminiNarrationAudio(
  env: WorkerEnv,
  options: {
    text: string;
    voiceProfileId?: string;
    userId?: string;
    persist?: boolean;
  }
) {
  const text = safePrompt(options.text);
  if (!text) throw new Error("text is required");

  const profile = geminiVoiceProfile(options.voiceProfileId);
  const audioBuffer = await requestGeminiTts(env, text, profile.voiceName);
  const duration = approximateDuration(text);

  if (options.persist === false) {
    const bytes = new Uint8Array(audioBuffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return {
      id: `preview-${profile.id}`,
      type: "audio",
      provider: "gemini",
      title: `Exemplo: ${profile.label}`,
      prompt: text,
      duration,
      audioUrl: `data:audio/wav;base64,${btoa(binary)}`,
      assetKey: null,
      createdAt: new Date().toISOString(),
    };
  }

  const id = crypto.randomUUID();
  const assetKey = `audio/gemini/${id}.wav`;
  const bucket = env.VIDEO_ASSETS as R2LikeBucket | undefined;
  if (!bucket) throw new Error("R2 bucket is not configured");

  await bucket.put(assetKey, audioBuffer, {
    httpMetadata: {
      contentType: "audio/wav",
    },
  });

  const asset = await insertMediaAsset(env, {
    id: `audio-${id}`,
    user_id: options.userId || null,
    type: "audio",
    provider: "gemini",
    title: text.length > 72 ? `${text.slice(0, 72)}...` : text,
    prompt: text,
    asset_key: assetKey,
    asset_url: assetUrlFromKey(assetKey),
    duration,
    metadata: {
      voice_profile: profile.id,
      voice_name: profile.voiceName,
      model_id: String(env.GEMINI_TTS_MODEL || DEFAULT_TTS_MODEL),
      estimated_duration: true,
    },
  });

  return {
    id: asset.id,
    type: asset.type,
    provider: asset.provider,
    title: asset.title,
    prompt: asset.prompt,
    duration: asset.duration,
    audioUrl: asset.asset_url,
    assetKey: asset.asset_key,
    createdAt: asset.created_at,
  };
}
