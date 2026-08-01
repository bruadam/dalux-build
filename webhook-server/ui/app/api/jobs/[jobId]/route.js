import { errorResponse, monitorToken, requireString } from "../../../../lib/server";

export const runtime = "nodejs";

async function proxyJobAction(jobId, method) {
  const monitorUrl = requireString(
    process.env.MONITOR_INTERNAL_URL || "http://127.0.0.1:8000",
    "MONITOR_INTERNAL_URL",
  ).replace(/\/$/, "");
  const token = await monitorToken();
  const suffix = method === "POST" ? "/test" : "";
  const response = await fetch(
    `${monitorUrl}/jobs/${encodeURIComponent(jobId)}${suffix}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
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
  return body;
}

export async function POST(_request, context) {
  try {
    const { jobId } = await context.params;
    return Response.json({ ok: true, data: await proxyJobAction(jobId, "POST") });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request, context) {
  try {
    const { jobId } = await context.params;
    await proxyJobAction(jobId, "DELETE");
    return Response.json({ ok: true, data: null });
  } catch (error) {
    return errorResponse(error);
  }
}
