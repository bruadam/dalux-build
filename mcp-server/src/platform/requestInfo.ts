import { resolveClientAddress, trustedProxyHops, type ClientAddress } from '@dalux-platform/db';

/** Set by the Node server for every request from the TCP peer; any value a client sends is overwritten. */
export const PEER_HEADER = 'x-peer-address';

/**
 * The client address behind the configured proxy hops (TRUSTED_PROXY_HOPS). X-Forwarded-For counts only
 * as far as that many proxies; entries a client puts in front of them are ignored.
 */
export function clientAddress(request: Request, hops: number = trustedProxyHops()): ClientAddress {
  return resolveClientAddress({ forwardedFor: request.headers.get('x-forwarded-for'), peer: request.headers.get(PEER_HEADER), trustedHops: hops });
}
