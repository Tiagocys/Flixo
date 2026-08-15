import type { WorkerEnv } from "../../_lib/types";

function backendUrl(env: WorkerEnv, path: string): string {
  const base = (env.MONEYPRINTER_API_URL || "").replace(/\/+$/, "");
  return `${base}/api/v1${path}`;
}

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  if (!env.MONEYPRINTER_API_URL) {
    return Response.json({ error: "MoneyPrinterTurbo backend nao configurado." }, { status: 503 });
  }
  const response = await fetch(backendUrl(env, "/youtube/upload-podcast"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.MONEYPRINTER_API_TOKEN
        ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
        : {}),
    },
    body: await request.text(),
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};
