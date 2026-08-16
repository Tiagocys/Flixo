import type { WorkerEnv } from "../../_lib/types";
import { requireCurrentUser } from "../../_lib/auth";
import { backendNotConfiguredResponse, moneyPrinterUrl } from "../../_lib/backend";

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const query = new URL(request.url).search;
  const url = moneyPrinterUrl(env, request, `/podcast/jobs${query}`);
  if (!url) return backendNotConfiguredResponse();
  const response = await fetch(url, {
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

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const url = moneyPrinterUrl(env, request, "/podcast/jobs");
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
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};
