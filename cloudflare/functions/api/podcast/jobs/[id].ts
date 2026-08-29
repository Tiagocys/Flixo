import type { WorkerEnv } from "../../../_lib/types";
import { requireCurrentUser } from "../../../_lib/auth";
import { backendNotConfiguredResponse, moneyPrinterUrl } from "../../../_lib/backend";
import { getClipperProject } from "../../../_lib/supabase";

function persistedProjectResponse(project: Awaited<ReturnType<typeof getClipperProject>>): Response {
  if (!project?.data) {
    return Response.json({ error: "Podcast job nao encontrado.", message: "Podcast job nao encontrado." }, { status: 404 });
  }
  return Response.json({ status: 200, data: { job: project.data }, job: project.data });
}

async function getPersistedProject(env: WorkerEnv, id: string, userId: string): Promise<Response> {
  try {
    return persistedProjectResponse(await getClipperProject(env, id, userId));
  } catch {
    return Response.json({ error: "Podcast job nao encontrado.", message: "Podcast job nao encontrado." }, { status: 404 });
  }
}

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ params, request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const id = String(params.id || "");
  const query = new URL(request.url).search;
  const url = moneyPrinterUrl(env, request, `/podcast/jobs/${encodeURIComponent(id)}${query}`);
  if (!url) return getPersistedProject(env, id, user.id);
  const response = await fetch(url, {
    headers: {
      ...(env.MONEYPRINTER_API_TOKEN
        ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
        : {}),
      "X-Flixo-User-Id": user.id,
    },
  }).catch(() => null);
  if (!response || response.status >= 500 || response.status === 404) {
    return getPersistedProject(env, id, user.id);
  }
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};

export const onRequestDelete: PagesFunction<WorkerEnv> = async ({ params, request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const id = String(params.id || "");
  const url = moneyPrinterUrl(env, request, `/podcast/jobs/${encodeURIComponent(id)}`);
  if (!url) return backendNotConfiguredResponse();
  const response = await fetch(url, {
    method: "DELETE",
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
