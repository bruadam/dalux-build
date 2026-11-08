import { authEvents, settings } from './schema';
import type { Db } from './db';
import { applyIpLogging, type ClientAddress, type IpLogging } from './clientIp';

export interface AuthEventInput {
  source: 'mcp' | 'oauth' | 'login';
  reason: string;
  accountId?: string;
  /** The display prefix only (`dxm_` plus a few characters); never pass a whole token. */
  tokenPrefix?: string;
  connectionSlug?: string;
  requestId?: string;
  address?: ClientAddress;
  userAgent?: string | null;
}

/** The first characters of a platform token, as shown in the interface; other strings give nothing. */
export function tokenDisplayPrefix(token: string | undefined, knownPrefixes: readonly string[]): string | undefined {
  return token && knownPrefixes.some((prefix) => token.startsWith(prefix)) ? token.slice(0, 12) : undefined;
}

export async function ipLoggingSetting(db: Db): Promise<IpLogging> {
  const [row] = await db.select({ mode: settings.ipLogging }).from(settings);
  return (row?.mode as IpLogging | undefined) ?? 'full';
}

/** Records a failed or unauthenticated attempt, applying the `ip_logging` setting. */
export async function recordAuthEvent(db: Db, event: AuthEventInput, ipLogging?: IpLogging): Promise<void> {
  const stored = applyIpLogging(event.address ?? {}, ipLogging ?? (await ipLoggingSetting(db)));
  await db.insert(authEvents).values({
    source: event.source,
    reason: event.reason,
    accountId: event.accountId,
    tokenPrefix: event.tokenPrefix,
    connectionSlug: event.connectionSlug?.slice(0, 100),
    requestId: event.requestId,
    clientIp: stored.ip,
    forwardedFor: stored.forwardedFor,
    userAgent: event.userAgent?.slice(0, 300),
  });
}
