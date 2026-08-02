import {
  createDaluxCredential,
  errorResponse,
  getDaluxCredentials,
  requireString,
  resolveBaseUrl,
  UnauthorizedError,
} from "@/lib/server";
import { getOrCreateAuthUser } from "@/lib/supabase/auth";
import type { DaluxCredential } from "@/types/database";

export const dynamic = "force-dynamic";

// Never send the raw API key back to the browser once it's stored.
function toPublicCredential(credential: DaluxCredential) {
  const { api_key: _apiKey, ...rest } = credential;
  return rest;
}

export async function GET() {
  try {
    const { appUserId } = await getOrCreateAuthUser();
    if (!appUserId) throw new UnauthorizedError();

    const credentials = await getDaluxCredentials(appUserId);
    return Response.json({ ok: true, data: (credentials || []).map(toPublicCredential) });
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

    return Response.json({ ok: true, data: toPublicCredential(credential) });
  } catch (error) {
    return errorResponse(error);
  }
}
