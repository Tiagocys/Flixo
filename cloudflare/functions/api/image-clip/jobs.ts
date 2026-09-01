import type { WorkerEnv } from "../../_lib/types";
import { requireCurrentUser } from "../../_lib/auth";
import { backendNotConfiguredResponse, moneyPrinterUrl } from "../../_lib/backend";

function processingUnavailableResponse() {
  return Response.json(
    {
      error: "Processamento temporariamente indisponível.",
      message:
        "O processamento local não está disponível agora. Verifique se o backend está rodando e tente novamente.",
    },
    { status: 503 }
  );
}

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const url = moneyPrinterUrl(env, request, "/image-clip/jobs");
  if (!url) return backendNotConfiguredResponse();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...(env.MONEYPRINTER_API_TOKEN
        ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
        : {}),
      "X-Flixo-User-Id": user.id,
    },
    body: await request.formData(),
  }).catch(() => null);
  if (!response) return processingUnavailableResponse();
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const query = new URL(request.url).search;
  const url = moneyPrinterUrl(env, request, `/image-clip/jobs${query}`);
  if (!url) return backendNotConfiguredResponse();
  const response = await fetch(url, {
    headers: {
      ...(env.MONEYPRINTER_API_TOKEN
        ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
        : {}),
      "X-Flixo-User-Id": user.id,
    },
  }).catch(() => null);
  if (!response) return processingUnavailableResponse();
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};
