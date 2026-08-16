import type { WorkerEnv } from "../../../_lib/types";
import { backendNotConfiguredResponse, moneyPrinterUrl } from "../../../_lib/backend";

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const url = moneyPrinterUrl(env, request, "/youtube/oauth/status");
  if (!url) return backendNotConfiguredResponse();
  const response = await fetch(url, {
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
