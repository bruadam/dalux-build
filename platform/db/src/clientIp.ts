import { isIP } from 'node:net';

export type IpLogging = 'full' | 'truncated' | 'off';

/** The client address and the raw chain it was taken from, before the `ip_logging` setting is applied. */
export interface ClientAddress {
  ip?: string;
  forwardedFor?: string;
}

function normalize(address: string): string | undefined {
  const value = address.trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  return isIP(value) ? value.toLowerCase() : undefined;
}

/**
 * The client IP behind `trustedHops` reverse proxies. `peer` is the TCP peer (the nearest proxy), when the
 * server can see it. Entries of X-Forwarded-For are counted from the right, because each proxy appends the
 * address it received the request from: whatever a client puts at the front of the header is never used.
 * Without a trusted proxy the TCP peer is the client and the header is ignored.
 */
export function resolveClientAddress(options: { forwardedFor?: string | null; peer?: string | null; trustedHops: number }): ClientAddress {
  const header = options.forwardedFor?.trim() || undefined;
  const hops = options.trustedHops;
  if (hops <= 0) return { ip: options.peer ? normalize(options.peer) : undefined };
  const entries = header ? header.split(',').map((entry) => entry.trim()) : [];
  const chain = [...entries, options.peer ?? ''];
  const picked = chain[Math.max(0, chain.length - 1 - hops)];
  return { ip: picked ? normalize(picked) : undefined, forwardedFor: header?.slice(0, 300) };
}

function expandIpv6(address: string): string[] {
  const [head, tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  return [...left, ...(address.includes('::') ? Array(missing).fill('0') : []), ...right].map((group) => group.replace(/^0+(?=.)/, ''));
}

/** IPv4 to its /24 and IPv6 to its /48, written as a network (`203.0.113.0/24`). */
export function truncateIp(ip: string): string {
  if (isIP(ip) === 4) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  return `${expandIpv6(ip).slice(0, 3).join(':')}::/48`;
}

/** What is stored for an address under the `ip_logging` setting. */
export function applyIpLogging(address: ClientAddress, mode: IpLogging): ClientAddress {
  if (mode === 'off') return {};
  if (mode === 'truncated') return { ip: address.ip && truncateIp(address.ip) };
  return address;
}

/** The number of trusted reverse-proxy hops from TRUSTED_PROXY_HOPS (0 when unset or invalid). */
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const hops = Number(env.TRUSTED_PROXY_HOPS ?? 0);
  return Number.isInteger(hops) && hops >= 0 ? hops : 0;
}
