import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

export function GET(request: Request): Promise<Response> {
  return toNextJsHandler(auth()).GET(request);
}

/** Logins are only created by the sign-up server action (first admin or invite link). */
export function POST(request: Request): Promise<Response> {
  if (new URL(request.url).pathname.includes('/sign-up')) return Promise.resolve(new Response('Not found', { status: 404 }));
  return toNextJsHandler(auth()).POST(request);
}
