import {
  DEFAULT_DALUX_BASE_URL,
  errorResponse,
  requireAuth,
} from "../../../lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    return Response.json({
      defaultBaseUrl: process.env.DALUX_BASE_URL || DEFAULT_DALUX_BASE_URL,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
