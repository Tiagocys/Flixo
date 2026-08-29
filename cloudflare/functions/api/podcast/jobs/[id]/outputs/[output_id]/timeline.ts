import type { WorkerEnv } from "../../../../../../_lib/types";
import { requireCurrentUser } from "../../../../../../_lib/auth";
import { backendNotConfiguredResponse, moneyPrinterUrl } from "../../../../../../_lib/backend";

export const onRequestPut: PagesFunction<WorkerEnv> = async ({ params, request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const id = String(params.id || "");
  const outputId = String(params.output_id || "");
  const url = moneyPrinterUrl(
    env,
    request,
    `/podcast/jobs/${encodeURIComponent(id)}/outputs/${encodeURIComponent(outputId)}/timeline`,
  );
  if (!url) return backendNotConfiguredResponse();
  const response = await fetch(
    url,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(env.MONEYPRINTER_API_TOKEN
          ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
          : {}),
        "X-Flixo-User-Id": user.id,
      },
      body: await request.text(),
    },
  );
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};
