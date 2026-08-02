import { deleteDaluxCredential, errorResponse, UnauthorizedError } from "@/lib/server";
import { getOrCreateAuthUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUserId } = await getOrCreateAuthUser();
    if (!appUserId) throw new UnauthorizedError();

    const { id } = await context.params;
    await deleteDaluxCredential(id, appUserId);
    return Response.json({ ok: true, data: null });
  } catch (error) {
    return errorResponse(error);
  }
}
