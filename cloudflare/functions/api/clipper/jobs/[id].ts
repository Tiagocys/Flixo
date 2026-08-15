import type { WorkerEnv } from "../../../_lib/types";
import { requireCurrentUser } from "../../../_lib/auth";

function backendUrl(env: WorkerEnv, path: string): string {
  const base = (env.MONEYPRINTER_API_URL || "").replace(/\/+$/, "");
  return `${base}/api/v1${path}`;
}

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ params, request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  if (!env.MONEYPRINTER_API_URL) {
    return Response.json({ error: "MoneyPrinterTurbo backend nao configurado." }, { status: 503 });
  }
  const id = String(params.id || "");
  const query = new URL(request.url).search;
  const response = await fetch(backendUrl(env, `/clipper/jobs/${encodeURIComponent(id)}${query}`), {
    headers: {
      ...(env.MONEYPRINTER_API_TOKEN
        ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
        : {}),
      "X-Flixo-User-Id": user.id,
    },
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};
