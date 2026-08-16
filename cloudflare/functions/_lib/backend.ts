import type { WorkerEnv } from "./types";

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function moneyPrinterBaseUrl(env: WorkerEnv, request: Request): string | null {
  const configured = String(env.MONEYPRINTER_API_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (isLocalRequest(request)) return "http://127.0.0.1:8080";
  return null;
}

export function moneyPrinterUrl(env: WorkerEnv, request: Request, path: string): string | null {
  const base = moneyPrinterBaseUrl(env, request);
  if (!base) return null;
  return `${base}/api/v1${path}`;
}

export function backendNotConfiguredResponse(): Response {
  return Response.json({ error: "MoneyPrinterTurbo backend nao configurado." }, { status: 503 });
}
