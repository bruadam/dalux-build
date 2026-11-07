import { and, desc, eq, isNull } from 'drizzle-orm';
import { accounts, apiTokens, connections, generateApiToken, type Db, type Tx } from '@dalux-platform/db';
import { audit, type Actor } from './actor';
import { UserError } from './errors';

/** Accounts may manage their own tokens; admins also manage robot tokens. */
async function assertCanManageTokens(tx: Tx, actor: Actor, accountId: string): Promise<void> {
  if (accountId === actor.accountId) return;
  const [account] = await tx.select({ type: accounts.type }).from(accounts).where(eq(accounts.id, accountId));
  if (actor.role !== 'admin' || account?.type !== 'robot') throw new UserError('You cannot manage tokens for this account');
}

export function listApiTokens(db: Db, accountId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      connectionName: connections.name,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .leftJoin(connections, eq(connections.id, apiTokens.connectionId))
    .where(eq(apiTokens.accountId, accountId))
    .orderBy(desc(apiTokens.createdAt));
}

/** Creates a `dxm_` token; the plaintext is returned once and only its sha256 hash is stored. */
export async function createApiToken(
  db: Db,
  actor: Actor,
  input: { accountId: string; name: string; connectionId?: string; expiresInDays?: number },
): Promise<{ id: string; token: string }> {
  const name = input.name.trim();
  if (!name) throw new UserError('Enter a token name');
  return db.transaction(async (tx) => {
    await assertCanManageTokens(tx, actor, input.accountId);
    const { token, hash, displayPrefix } = generateApiToken();
    const [row] = await tx
      .insert(apiTokens)
      .values({
        accountId: input.accountId,
        name,
        tokenHash: hash,
        prefix: displayPrefix,
        connectionId: input.connectionId || null,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
      })
      .returning({ id: apiTokens.id });
    await audit(tx, actor, 'token.create', 'api_token', row.id);
    return { id: row.id, token };
  });
}

export async function revokeApiToken(db: Db, actor: Actor, tokenId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [token] = await tx.select({ accountId: apiTokens.accountId }).from(apiTokens).where(eq(apiTokens.id, tokenId));
    if (!token) throw new UserError('Token not found');
    await assertCanManageTokens(tx, actor, token.accountId);
    await tx
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)));
    await audit(tx, actor, 'token.revoke', 'api_token', tokenId);
  });
}
