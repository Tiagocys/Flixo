import type { WorkerEnv } from "../_lib/types";

function backendTasksUrl(env: WorkerEnv, requestUrl: string): string {
  const base = (env.MONEYPRINTER_API_URL || "").replace(/\/+$/, "");
  const url = new URL(requestUrl);
  return `${base}${url.pathname}${url.search}`;
}

async function proxyTaskAsset(request: Request, env: WorkerEnv): Promise<Response> {
  if (!env.MONEYPRINTER_API_URL) {
    return Response.json({ error: "MoneyPrinterTurbo backend nao configurado." }, { status: 503 });
  }

  const response = await fetch(backendTasksUrl(env, request.url), {
    method: request.method,
    headers: {
      Range: request.headers.get("Range") || "",
      ...(env.MONEYPRINTER_API_TOKEN
        ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
        : {}),
    },
  });

  const headers = new Headers(response.headers);
  headers.delete("Content-Security-Policy");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ request, env }) =>
  proxyTaskAsset(request, env);

export const onRequestHead: PagesFunction<WorkerEnv> = async ({ request, env }) =>
  proxyTaskAsset(request, env);
