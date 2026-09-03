import { requireCurrentUser } from "../../_lib/auth";
import { generateBytePlusImage } from "../../_lib/byteplus-image";
import { normalizeText, type WorkerEnv } from "../../_lib/types";

function jsonError(message: string, status = 400) {
  return Response.json({ error: message, message }, { status });
}

function parseSettings(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const { imageDataUrl, ...settings } = input as Record<string, unknown>;
  return {
    ...settings,
    imageDataUrl,
  };
}

function buildAssetUrl(asset: { asset_key: string | null; asset_url: string | null }) {
  if (asset.asset_url) return asset.asset_url;
  if (asset.asset_key) return `/api/assets?key=${encodeURIComponent(asset.asset_key)}`;
  return null;
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
  if (!prompt) return jsonError("prompt is required");
  if (prompt.length > 1200) return jsonError("prompt is too long");

  const settings = parseSettings(
    payload && typeof payload === "object" ? (payload as Record<string, unknown>).settings : {}
  );

  try {
    const asset = await generateBytePlusImage(env, {
      prompt,
      userId: user.id,
      settings,
    });
    return Response.json({
      image: {
        id: asset.id,
        type: asset.type,
        provider: asset.provider,
        title: asset.title,
        prompt: asset.prompt,
        assetKey: asset.asset_key,
        url: buildAssetUrl(asset),
        imageUrl: buildAssetUrl(asset),
        metadata: asset.metadata || {},
        createdAt: asset.created_at,
      },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to generate image",
      500
    );
  }
}
