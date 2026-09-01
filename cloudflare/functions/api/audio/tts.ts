import type { WorkerEnv } from "../../_lib/types";
import { createGeminiNarrationAudio } from "../../_lib/gemini";
import { requireCurrentUser } from "../../_lib/auth";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message, message }, { status });
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

  const record = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) return jsonError("text is required");
  if (text.length > 1200) return jsonError("text is too long");

  try {
    const audio = await createGeminiNarrationAudio(env, {
      text,
      userId: user.id,
      voiceProfileId:
        typeof record.voiceProfile === "string" ? record.voiceProfile : undefined,
      persist: record.preview !== true,
    });
    return Response.json({ audio });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to create narration",
      500
    );
  }
}
