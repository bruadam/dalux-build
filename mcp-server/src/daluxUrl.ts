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

export function validateDaluxBaseUrl(rawBaseUrl: string): { baseUrl: string } | { error: string } {
  const baseUrl = rawBaseUrl.trim();
  let parsed: URL;
  try {
    // The URL parser silently drops tabs and newlines, but the string is used as given.
    if (/[\u0000-\u0020\u007f]/.test(baseUrl)) throw new Error('control characters');
    parsed = new URL(baseUrl);
  } catch {
    return { error: 'must be a valid URL' };
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !isAllowedDaluxHost(parsed.hostname)) {
    return { error: 'must be an https://*.dalux.com URL' };
  }
  return { baseUrl };
}
