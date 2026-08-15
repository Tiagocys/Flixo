import { PIPELINE_STEPS } from "../_lib/types";
import type { WorkerEnv } from "../_lib/types";
import { backendAvailable } from "../_lib/moneyprinter";
import { bytePlusAvailable } from "../_lib/byteplus";
import { pexelsAvailable } from "../_lib/pexels";
import { elevenLabsAvailable, VOICE_PROFILES } from "../_lib/elevenlabs";
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
      pexels: pexelsAvailable(env),
      pixabay: Boolean(env.PIXABAY_APIKEY || env.PIXABAY_API_KEY),
      elevenlabs: elevenLabsAvailable(env),
    },
    defaults: {
      aspect: "portrait",
      source: "pexels",
      tts: "elevenlabs",
      voiceProfile: "bella-narrative",
      clipDuration: 4,
      maxTimelineSeconds: 60,
    },
    voiceProfiles: VOICE_PROFILES.map(({ id, label, disabled, reason }) => ({
      id,
      label,
      disabled: Boolean(disabled),
      reason: reason || "",
    })),
  });
}
