import { DEFAULT_DALUX_BASE_URL } from "../../../lib/server";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    defaultBaseUrl: process.env.DALUX_BASE_URL || DEFAULT_DALUX_BASE_URL,
  });
}
