/**
 * Shared validation for a caller-supplied Dalux Build API base URL — used by
 * both the static X-Dalux-Base-Url header path (http.ts) and the OAuth
 * authorize form (oauth.ts). This endpoint proxies whatever baseUrl it's
 * given, so without this check a caller could point it at an arbitrary
 * internal URL (SSRF).
 */
export function isAllowedDaluxHost(hostname: string): boolean {
  return hostname === 'dalux.com' || hostname.endsWith('.dalux.com');
}

export function validateDaluxBaseUrl(baseUrl: string): { baseUrl: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { error: 'must be a valid URL' };
  }
  if (parsed.protocol !== 'https:' || !isAllowedDaluxHost(parsed.hostname)) {
    return { error: 'must be an https://*.dalux.com URL' };
  }
  return { baseUrl };
}
