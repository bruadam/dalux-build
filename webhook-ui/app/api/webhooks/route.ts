import { errorResponse, getWebhooks, UnauthorizedError } from "@/lib/server";
import { getOrCreateAuthUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { appUserId } = await getOrCreateAuthUser();
    if (!appUserId) throw new UnauthorizedError();

    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page")) || 1;
    const pageSize = Number(searchParams.get("pageSize")) || 50;

    const result = await getWebhooks(appUserId, { page, pageSize });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
