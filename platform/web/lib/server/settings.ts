import { sql } from 'drizzle-orm';
import { encryptSecret, loadEncryptionKey, settings, type Db } from '@dalux-platform/db';
import { assertAdmin, audit, type Actor } from './actor';

export async function getSettings(db: Db): Promise<{ embeddingKeySet: boolean; headerModeEnabled: boolean }> {
  const [row] = await db
    .select({ embeddingKeySet: sql<boolean>`${settings.embeddingKeyEncrypted} is not null`, headerModeEnabled: settings.headerModeEnabled })
    .from(settings);
  return row ?? { embeddingKeySet: false, headerModeEnabled: false };
}

async function upsertSettings(db: Db, actor: Actor, action: string, values: Partial<typeof settings.$inferInsert>): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    const set = { ...values, updatedAt: new Date() };
    await tx.insert(settings).values({ id: true, ...set }).onConflictDoUpdate({ target: settings.id, set });
    await audit(tx, actor, action, 'settings', 'settings');
  });
}

/** `null` removes the key, which stops sending document text to the embedding provider. */
export function setEmbeddingKey(db: Db, actor: Actor, apiKey: string | null): Promise<void> {
  const key = apiKey?.trim() || null;
  return upsertSettings(db, actor, key ? 'settings.embedding_key.set' : 'settings.embedding_key.clear', {
    embeddingKeyEncrypted: key ? encryptSecret(key, loadEncryptionKey()) : null,
  });
}

export function setHeaderMode(db: Db, actor: Actor, enabled: boolean): Promise<void> {
  return upsertSettings(db, actor, enabled ? 'settings.header_mode.on' : 'settings.header_mode.off', {
    headerModeEnabled: enabled,
  });
}
