import {
  errorResponse,
  monitorToken,
  requireAuth,
  requireString,
} from "../../../lib/server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    await requireAuth();
    const payload = await request.json();
    const jobType = payload?.jobType;
    if (!['change', 'freshness'].includes(jobType)) {
      const error = new Error("jobType must be change or freshness");
      error.status = 400;
      throw error;
    }

    const monitorUrl = requireString(
      process.env.MONITOR_INTERNAL_URL || "http://127.0.0.1:8000",
      "MONITOR_INTERNAL_URL",
    ).replace(/\/$/, "");
    const token = await monitorToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (payload.idempotencyKey) {
      headers["Idempotency-Key"] = String(payload.idempotencyKey);
    }

    const response = await fetch(`${monitorUrl}/jobs/${jobType}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload.job),
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body?.detail;
      const error = new Error(
        typeof detail === "string"
          ? detail
          : detail
            ? JSON.stringify(detail)
            : `Monitor returned HTTP ${response.status}`,
      );
      error.status = response.status;
      throw error;
    }
    return Response.json({ ok: true, data: body }, { status: response.status });
  } catch (error) {
    return errorResponse(error);
  }
}
