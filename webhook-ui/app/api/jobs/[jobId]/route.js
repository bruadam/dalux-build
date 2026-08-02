import { errorResponse, requireAuth } from "../../../../lib/server";
import { proxyJobAction } from "../../../../lib/monitor";

export const runtime = "nodejs";

export async function POST(_request, context) {
  try {
    await requireAuth();
    const { jobId } = await context.params;
    return Response.json({ ok: true, data: await proxyJobAction(jobId, "POST") });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request, context) {
  try {
    await requireAuth();
    const { jobId } = await context.params;
    await proxyJobAction(jobId, "DELETE");
    return Response.json({ ok: true, data: null });
  } catch (error) {
    return errorResponse(error);
  }
}
