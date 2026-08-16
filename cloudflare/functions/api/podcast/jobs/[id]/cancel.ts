import type { WorkerEnv } from "../../../../_lib/types";
import { requireCurrentUser } from "../../../../_lib/auth";
import { backendNotConfiguredResponse, moneyPrinterUrl } from "../../../../_lib/backend";

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ params, request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const id = String(params.id || "");
  const url = moneyPrinterUrl(env, request, `/podcast/jobs/${encodeURIComponent(id)}/cancel`);
  if (!url) return backendNotConfiguredResponse();
  const response = await fetch(url, {
    method: "POST",
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
