import {
  createDaluxCredential,
  errorResponse,
  getDaluxCredentials,
  requireString,
  resolveBaseUrl,
  UnauthorizedError,
} from "@/lib/server";
import { getOrCreateAuthUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { appUserId } = await getOrCreateAuthUser();
    if (!appUserId) throw new UnauthorizedError();

    const credentials = await getDaluxCredentials(appUserId);
    return Response.json({ ok: true, data: credentials || [] });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { appUserId } = await getOrCreateAuthUser();
    if (!appUserId) throw new UnauthorizedError();

    const payload = await request.json();
    const name = requireString(payload?.name, "name");
    const apiKey = requireString(payload?.apiKey, "apiKey");
    const baseUrl = resolveBaseUrl(payload?.baseUrl);

    const credential = await createDaluxCredential({
      user_id: appUserId,
      name,
      api_key: apiKey,
      base_url: baseUrl,
      dalux_user_id: payload?.daluxUserId || null,
      description: payload?.description || null,
    });

    return Response.json({ ok: true, data: credential });
  } catch (error) {
    return errorResponse(error);
  }
}
