import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { oauthClients, oauthCodes } from './schema';
import { hashApiToken } from './tokens';

/** OAuth access tokens; the MCP server tells them apart from `dxm_` API tokens by this prefix. */
export const OAUTH_ACCESS_TOKEN_PREFIX = 'dxo_';
export const OAUTH_REFRESH_TOKEN_PREFIX = 'dxr_';
export const OAUTH_CODE_TTL_MS = 60_000;
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** A random secret and its stored form (sha256 hex, like API tokens). */
export function generateOAuthSecret(prefix = ''): { value: string; hash: string } {
  const value = prefix + randomBytes(32).toString('base64url');
  return { value, hash: hashApiToken(value) };
}

/** The client, if `redirectUri` is one of its registered redirect URIs. */
export async function findOAuthClient(db: Db, clientId: string, redirectUri: string) {
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
  return client?.redirectUris.includes(redirectUri) ? client : undefined;
}

/** Stores an approved authorization request; the returned code is exchanged once at the token endpoint. */
export async function createAuthorizationCode(
  db: Db,
  input: {
    clientId: string;
    accountId: string;
    connectionId: string;
    redirectUri: string;
    codeChallenge: string;
    capabilities: string[] | null;
  },
): Promise<string> {
  const { value, hash } = generateOAuthSecret();
  await db.insert(oauthCodes).values({ ...input, codeHash: hash, expiresAt: new Date(Date.now() + OAUTH_CODE_TTL_MS) });
  return value;
}
