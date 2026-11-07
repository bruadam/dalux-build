import { asc, eq } from 'drizzle-orm';
import { createClient } from 'dalux-build-api';
import { connections, encryptSecret, loadEncryptionKey, type Db } from '@dalux-platform/db';
import { validateDaluxBaseUrl } from '../../../../mcp-server/src/daluxUrl';
import { assertAdmin, audit, type Actor } from './actor';
import { UserError } from './errors';

export type VerifyKey = (baseUrl: string, apiKey: string) => Promise<void>;

/** Checks the key with a read call (list projects) before it is saved (PRD 6.2). */
export const verifyDaluxKey: VerifyKey = async (baseUrl, apiKey) => {
  try {
    await createClient({ baseUrl, apiKey }).projects.listProjects();
  } catch (error) {
    throw new UserError(`Dalux did not accept the key: ${(error as Error).message}`);
  }
};

/** Never selects the encrypted key. */
export function listConnections(db: Db) {
  return db
    .select({
      id: connections.id,
      name: connections.name,
      slug: connections.slug,
      baseUrl: connections.baseUrl,
      apiKeyLast4: connections.apiKeyLast4,
      updatedAt: connections.updatedAt,
    })
    .from(connections)
    .orderBy(asc(connections.name));
}

function checkedBaseUrl(baseUrl: string): string {
  const result = validateDaluxBaseUrl(baseUrl.trim());
  if ('error' in result) throw new UserError(`Base URL ${result.error}`);
  return result.baseUrl;
}

function sealKey(apiKey: string) {
  return { apiKeyEncrypted: encryptSecret(apiKey, loadEncryptionKey()), apiKeyLast4: apiKey.slice(-4) };
}

export async function addConnection(
  db: Db,
  actor: Actor,
  input: { name: string; slug: string; baseUrl: string; apiKey: string },
  verify: VerifyKey = verifyDaluxKey,
): Promise<string> {
  assertAdmin(actor);
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const apiKey = input.apiKey.trim();
  if (!name) throw new UserError('Enter a name');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new UserError('The slug may only hold lowercase letters, digits, and dashes');
  if (!apiKey) throw new UserError('Enter the API key');
  const baseUrl = checkedBaseUrl(input.baseUrl);
  await verify(baseUrl, apiKey);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(connections)
      .values({ name, slug, baseUrl, ...sealKey(apiKey) })
      .returning({ id: connections.id });
    await audit(tx, actor, 'connection.create', 'connection', row.id);
    return row.id;
  });
}

export async function rotateConnectionKey(
  db: Db,
  actor: Actor,
  connectionId: string,
  newApiKey: string,
  verify: VerifyKey = verifyDaluxKey,
): Promise<void> {
  assertAdmin(actor);
  const apiKey = newApiKey.trim();
  if (!apiKey) throw new UserError('Enter the API key');
  const [connection] = await db.select({ baseUrl: connections.baseUrl }).from(connections).where(eq(connections.id, connectionId));
  if (!connection) throw new UserError('Connection not found');
  await verify(connection.baseUrl, apiKey);
  await db.transaction(async (tx) => {
    await tx
      .update(connections)
      .set({ ...sealKey(apiKey), updatedAt: new Date() })
      .where(eq(connections.id, connectionId));
    await audit(tx, actor, 'connection.rotate_key', 'connection', connectionId);
  });
}
