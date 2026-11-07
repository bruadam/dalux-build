import { createHash, randomBytes } from 'node:crypto';

export const API_TOKEN_PREFIX = 'dxm_';
const DISPLAY_PREFIX_LENGTH = 12;

/** The stored form of an API token: sha256 hex of the full token string, `dxm_` included. */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A new API token. Only `hash` and `displayPrefix` are stored; `token` is shown once. */
export function generateApiToken(): { token: string; hash: string; displayPrefix: string } {
  const token = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashApiToken(token), displayPrefix: token.slice(0, DISPLAY_PREFIX_LENGTH) };
}
