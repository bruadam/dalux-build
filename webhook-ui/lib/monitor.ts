// ============================================
// External Monitor Service Client
// Thin helper around the Python "monitor" service that actually schedules
// and runs change/freshness jobs (MONITOR_INTERNAL_URL). Shared by the
// jobs/[jobId] proxy route and the webhooks CRUD routes.
// ============================================

import { monitorToken, requireString } from "./server";

function monitorBaseUrl(): string {
  return requireString(
    process.env.MONITOR_INTERNAL_URL || "http://127.0.0.1:8000",
    "MONITOR_INTERNAL_URL",
  ).replace(/\/$/, "");
}

async function monitorError(response: Response): Promise<Error & { status?: number }> {
  const body = await response.json().catch(() => null);
  const detail = body?.detail;
  const error: Error & { status?: number } = new Error(
    typeof detail === "string"
      ? detail
      : detail
        ? JSON.stringify(detail)
        : `Monitor returned HTTP ${response.status}`,
  );
  error.status = response.status;
  return error;
}

/**
 * POST /jobs/{jobId}/test (send a test delivery) or DELETE /jobs/{jobId}
 * (cancel the recurring job) on the monitor service.
 */
export async function proxyJobAction(jobId: string, method: "POST" | "DELETE") {
  const token = await monitorToken();
  const suffix = method === "POST" ? "/test" : "";
  const response = await fetch(
    `${monitorBaseUrl()}/jobs/${encodeURIComponent(jobId)}${suffix}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw await monitorError(response);
  }
  return body;
}

/**
 * PATCH /jobs/{jobId} — enables or disables a recurring job on the monitor
 * service without deleting it. Returns the monitor's updated JobView
 * (includes the re-armed `nextRunAt` when enabling).
 */
export async function updateMonitorJob(jobId: string, updates: { enabled: boolean }) {
  const token = await monitorToken();
  const response = await fetch(`${monitorBaseUrl()}/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw await monitorError(response);
  }
  return body as { jobId: string; nextRunAt: string; enabled: boolean };
}

/**
 * POST /jobs/{jobType} — registers a new recurring job on the monitor
 * service. Returns the monitor's response body (expects at least
 * { jobId, nextRunAt } on success).
 */
export async function registerMonitorJob(
  jobType: string,
  job: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const token = await monitorToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = String(idempotencyKey);
  }

  const response = await fetch(`${monitorBaseUrl()}/jobs/${jobType}`, {
    method: "POST",
    headers,
    body: JSON.stringify(job),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw await monitorError(response);
  }
  return { body, status: response.status };
}
