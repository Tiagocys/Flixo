import type { WorkerEnv } from "../../_lib/types";
import { backendNotConfiguredResponse, moneyPrinterUrl } from "../../_lib/backend";

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const url = moneyPrinterUrl(env, request, "/youtube/upload");
  if (!url) return backendNotConfiguredResponse();
  const response = await fetch(url, {
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
