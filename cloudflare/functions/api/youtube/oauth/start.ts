import type { WorkerEnv } from "../../../_lib/types";

function backendUrl(env: WorkerEnv, path: string): string {
  const base = (env.MONEYPRINTER_API_URL || "").replace(/\/+$/, "");
  return `${base}/api/v1${path}`;
}

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  if (!env.MONEYPRINTER_API_URL) {
    return Response.json({ error: "MoneyPrinterTurbo backend nao configurado." }, { status: 503 });
  }
  const requestUrl = new URL(request.url);
  const response = await fetch(backendUrl(env, `/youtube/oauth/start${requestUrl.search}`), {
    headers: {
      ...(env.MONEYPRINTER_API_TOKEN
        ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
        : {}),
    },
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};
