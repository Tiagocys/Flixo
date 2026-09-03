import { PIPELINE_STEPS } from "../_lib/types";
import type { WorkerEnv } from "../_lib/types";
import { backendAvailable } from "../_lib/moneyprinter";
import { bytePlusAvailable } from "../_lib/byteplus";
import { bytePlusImageAvailable } from "../_lib/byteplus-image";
import { GEMINI_VOICE_PROFILES, geminiTtsAvailable } from "../_lib/gemini";
import { supabaseAvailable } from "../_lib/supabase";
import { authConfigured } from "../_lib/auth";

export async function onRequestGet({ env }: { env: WorkerEnv }) {
  return Response.json({
    appName: "MoneyPrinterTurbo Cloud",
    mode: "cloud",
    pipelineSteps: PIPELINE_STEPS,
    storage: {
      supabase: supabaseAvailable(env),
      auth: authConfigured(env),
      r2: Boolean(env.VIDEO_ASSETS),
      backend: backendAvailable(env),
      byteplus: bytePlusAvailable(env),
      byteplusImage: bytePlusImageAvailable(env),
      pexels: false,
      pixabay: false,
      geminiTts: geminiTtsAvailable(env),
    },
    defaults: {
      aspect: "portrait",
      source: "ai",
      tts: "gemini",
      voiceProfile: "kore-firme",
      clipDuration: 4,
      maxTimelineSeconds: 60,
    },
    voiceProfiles: GEMINI_VOICE_PROFILES.map(({ id, label, voiceName, style, sample }) => ({
      id,
      label,
      voiceName,
      disabled: false,
      reason: "",
      style,
      sample,
    })),
  });
}
