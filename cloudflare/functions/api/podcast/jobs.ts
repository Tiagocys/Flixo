import type { WorkerEnv } from "../../_lib/types";
import { requireCurrentUser } from "../../_lib/auth";
import { backendNotConfiguredResponse, moneyPrinterUrl } from "../../_lib/backend";
import { getBillingCustomer, listClipperProjects } from "../../_lib/supabase";
import { subscriptionStatusIsActive } from "../../_lib/stripe";

function emptyJobsResponse() {
  return Response.json({ status: 200, data: { jobs: [] }, jobs: [] });
}

function clipperProjectsResponse(projects: Awaited<ReturnType<typeof listClipperProjects>>) {
  return Response.json({
    status: 200,
    data: { jobs: projects },
    jobs: projects,
  });
}

async function listPersistedJobs(env: WorkerEnv, limit: number, userId: string): Promise<Response> {
  try {
    return clipperProjectsResponse(await listClipperProjects(env, limit, userId));
  } catch {
    return emptyJobsResponse();
  }
}

function processingUnavailableResponse() {
  return Response.json(
    {
      error: "Processamento temporariamente indisponível.",
      message:
        "O processamento local não está disponível agora. Verifique se o backend está rodando e tente novamente.",
    },
    { status: 503 }
  );
}

function saoPauloDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function userIsPro(env: WorkerEnv, userId: string): Promise<boolean> {
  const billing = await getBillingCustomer(env, userId).catch(() => null);
  return subscriptionStatusIsActive(billing?.status);
}

async function enforceFreeDailyProjectLimit(env: WorkerEnv, userId: string): Promise<Response | null> {
  if (await userIsPro(env, userId)) return null;
  const today = saoPauloDateKey(new Date());
  const projects = await listClipperProjects(env, 50, userId).catch(() => []);
  const hasProjectToday = projects.some((project) => saoPauloDateKey(project.created_at || "") === today);
  if (!hasProjectToday) return null;
  return Response.json(
    {
      error: "Limite diário do plano gratuito.",
      message:
        "No plano gratuito, você pode iniciar 1 projeto por dia. Tente novamente amanhã ou assine o Pro para liberar mais projetos.",
      data: { free_daily_project_limit: true },
    },
    { status: 429 }
  );
}

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const requestUrl = new URL(request.url);
  const limit = Number(requestUrl.searchParams.get("limit") || 20);
  const query = requestUrl.search;
  const url = moneyPrinterUrl(env, request, `/podcast/jobs${query}`);
  if (!url) return listPersistedJobs(env, limit, user.id);
  const response = await fetch(url, {
    headers: {
      ...(env.MONEYPRINTER_API_TOKEN
        ? { Authorization: `Bearer ${env.MONEYPRINTER_API_TOKEN}` }
        : {}),
      "X-Flixo-User-Id": user.id,
    },
  }).catch(() => null);
  if (!response || response.status >= 500) return listPersistedJobs(env, limit, user.id);
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const limitResponse = await enforceFreeDailyProjectLimit(env, user.id);
  if (limitResponse) return limitResponse;
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
  }).catch(() => null);
  if (!response) return processingUnavailableResponse();
  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};
