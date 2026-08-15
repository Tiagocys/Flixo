import type { WorkerEnv } from "./types";
import { insertMediaAsset } from "./supabase";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const MAX_TTS_CHARS = 1200;

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

export interface VoiceProfile {
  id: string;
  label: string;
  voiceId: string;
  displayName: string;
  modelId: string;
  disabled?: boolean;
  reason?: string;
}

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "bella-narrative",
    label: "Bella - Narrativa feminina",
    voiceId: "hpp4J3VqNfWAUOO0d1Us",
    displayName: "Bella",
    modelId: DEFAULT_MODEL_ID,
  },
  {
    id: "sarah-confident",
    label: "Sarah - Feminina confiante",
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    displayName: "Sarah",
    modelId: DEFAULT_MODEL_ID,
  },
  {
    id: "matilda-professional",
    label: "Matilda - Feminina profissional",
    voiceId: "XrExE9yKIg1WjnnlVkGX",
    displayName: "Matilda",
    modelId: DEFAULT_MODEL_ID,
  },
  {
    id: "jessica-social",
    label: "Jessica - Feminina social media",
    voiceId: "cgSgspJ2msm6clMCkdW9",
    displayName: "Jessica",
    modelId: DEFAULT_MODEL_ID,
  },
  {
    id: "brian-resonant",
    label: "Brian - Masculina profunda",
    voiceId: "nPczCjzI2devNBz1zQrb",
    displayName: "Brian",
    modelId: DEFAULT_MODEL_ID,
  },
  {
    id: "liam-social",
    label: "Liam - Masculina social media",
    voiceId: "TX3LPaxmHKxFdv7VOQHJ",
    displayName: "Liam",
    modelId: DEFAULT_MODEL_ID,
  },
  {
    id: "daniel-broadcaster",
    label: "Daniel - Masculina locutor",
    voiceId: "onwK4e9ZLuTAKqWW03F9",
    displayName: "Daniel",
    modelId: DEFAULT_MODEL_ID,
  },
  {
    id: "leni-br-paid",
    label: "Leni - Feminina brasileira (requer plano)",
    voiceId: "rdBSfr2PAUTCe39SX2fo",
    displayName: "Leni",
    modelId: DEFAULT_MODEL_ID,
    disabled: true,
    reason: "Voz brasileira de biblioteca/professional. A API retorna payment_required no plano atual.",
  },
  {
    id: "paulo-br-paid",
    label: "Paulo - Masculina informativa (requer plano)",
    voiceId: "Qrdut83w0Cr152Yb4Xn3",
    displayName: "Paulo",
    modelId: DEFAULT_MODEL_ID,
    disabled: true,
    reason: "Voz brasileira de biblioteca/professional. A API retorna payment_required no plano atual.",
  },
  {
    id: "danilo-br-paid",
    label: "Danilo - Masculina documental (requer plano)",
    voiceId: "rVRk0uJAtO8T38Gm03mf",
    displayName: "Danilo",
    modelId: DEFAULT_MODEL_ID,
    disabled: true,
    reason: "Voz brasileira de biblioteca/professional. A API retorna payment_required no plano atual.",
  },
  {
    id: "adam-borges-br-paid",
    label: "Adam Borges - Masculina expressiva (requer plano)",
    voiceId: "ZqE9vIHPcrC35dZv0Svu",
    displayName: "Adam Borges",
    modelId: DEFAULT_MODEL_ID,
    disabled: true,
    reason: "Voz brasileira de biblioteca/professional. A API retorna payment_required no plano atual.",
  },
  {
    id: "randel-br-paid",
    label: "Randel - Masculina profunda (requer plano)",
    voiceId: "jkiD8IhCU1i2V7VvmNwi",
    displayName: "Randel",
    modelId: DEFAULT_MODEL_ID,
    disabled: true,
    reason: "Voz brasileira de biblioteca/professional. A API retorna payment_required no plano atual.",
  },
  {
    id: "dyego-br-paid",
    label: "Dyego Noticias - Masculina notícias (requer plano)",
    voiceId: "eUAnqvLQWNX29twcYLUM",
    displayName: "Dyego Noticias",
    modelId: DEFAULT_MODEL_ID,
    disabled: true,
    reason: "Voz brasileira de biblioteca/professional. A API retorna payment_required no plano atual.",
  },
  {
    id: "male-br-iconic-cid",
    label: "Cid Moreira - Masculina icônica (restrita)",
    voiceId: "8EBve3BoypONvZgvuCpO",
    displayName: "Cid Moreira",
    modelId: DEFAULT_MODEL_ID,
    disabled: true,
    reason: "A chave atual lista esta voz, mas não tem permissão para gerar TTS com ela.",
  },
];

function apiKey(env: WorkerEnv): string {
  return String(env.ELEVENLABS_APIKEY || env.ELEVENLABS_API_KEY || "");
}

export function elevenLabsAvailable(env: WorkerEnv): boolean {
  return Boolean(apiKey(env));
}

function voiceProfile(id: unknown): VoiceProfile {
  const selected = String(id || "");
  return VOICE_PROFILES.find((profile) => profile.id === selected) || VOICE_PROFILES[0];
}

export function elevenLabsVoiceNameForProfile(id: unknown): string {
  const profile = voiceProfile(id);
  if (profile.disabled) {
    throw new Error(profile.reason || "A voz selecionada não está disponível para TTS.");
  }
  return `elevenlabs:${profile.voiceId}:${profile.displayName}`;
}

function safePrompt(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_TTS_CHARS);
}

function approximateDuration(text: string): number {
  return Math.max(1, Math.round(text.length / 14));
}

function assetUrlFromKey(key: string): string {
  return `/api/assets?key=${encodeURIComponent(key)}`;
}

export async function createNarrationAudio(
  env: WorkerEnv,
  options: {
    text: string;
    voiceProfileId?: string;
    userId?: string;
  }
) {
  const key = apiKey(env);
  if (!key) {
    throw new Error("ELEVENLABS_APIKEY is not configured");
  }
  const text = safePrompt(options.text);
  if (!text) {
    throw new Error("text is required");
  }

  const profile = voiceProfile(options.voiceProfileId);
  if (profile.disabled) {
    throw new Error(profile.reason || "A voz selecionada não está disponível para TTS.");
  }
  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(
      profile.voiceId
    )}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": key,
      },
      body: JSON.stringify({
        text,
        model_id: profile.modelId,
        voice_settings: {
          stability: 0.48,
          similarity_boost: 0.78,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    const message =
      typeof (payload as Record<string, unknown>).detail === "string"
        ? String((payload as Record<string, unknown>).detail)
        : `ElevenLabs TTS failed: ${response.status}`;
    throw new Error(message);
  }

  const id = crypto.randomUUID();
  const assetKey = `audio/elevenlabs/${id}.mp3`;
  const bucket = env.VIDEO_ASSETS as R2LikeBucket | undefined;
  if (!bucket) {
    throw new Error("R2 bucket is not configured");
  }

  await bucket.put(assetKey, response.body, {
    httpMetadata: {
      contentType: "audio/mpeg",
    },
  });

  const duration = approximateDuration(text);
  const asset = await insertMediaAsset(env, {
    id: `audio-${id}`,
    user_id: options.userId || null,
    type: "audio",
    provider: "elevenlabs",
    title: text.length > 72 ? `${text.slice(0, 72)}...` : text,
    prompt: text,
    asset_key: assetKey,
    asset_url: assetUrlFromKey(assetKey),
    duration,
    metadata: {
      voice_profile: profile.id,
      model_id: profile.modelId,
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
