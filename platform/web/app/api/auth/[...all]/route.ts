import { toNextJsHandler } from 'better-auth/next-js';
import { recordAuthEvent, resolveClientAddress, trustedProxyHops } from '@dalux-platform/db';
import { auth } from '@/lib/auth';
import { db } from '@/lib/server/db';

export function GET(request: Request): Promise<Response> {
  return toNextJsHandler(auth()).GET(request);
}

/** Failed sign-ins and the sign-in rate limit go to `auth_events` (no email, no password). */
function recordSignInFailure(request: Request, response: Response): void {
  if (response.ok) return;
  const reason = response.status === 429 ? 'login_rate_limited' : 'login_failed';
  recordAuthEvent(db(), {
    source: 'login',
    reason,
    address: resolveClientAddress({ forwardedFor: request.headers.get('x-forwarded-for'), trustedHops: trustedProxyHops() }),
    userAgent: request.headers.get('user-agent'),
  }).catch((error: unknown) => console.error('[audit] failed to record sign-in failure:', error));
}

/** Logins are only created by the sign-up server action (first admin or invite link). */
export async function POST(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname.includes('/sign-up')) return new Response('Not found', { status: 404 });
  const response = await toNextJsHandler(auth()).POST(request);
  if (pathname.includes('/sign-in')) recordSignInFailure(request, response);
  return response;
}
