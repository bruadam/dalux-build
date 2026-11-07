/**
 * Dalux user mapping (PRD 6.8). The worker copies each connection's Dalux
 * users (all projects, deduplicated by user id) into `dalux_users`, then links
 * personal accounts by email. Manual links are never changed here.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { DaluxClient } from 'dalux-build-api';
import { accounts, connections, daluxUserLinks, daluxUsers, type Db } from '@dalux-platform/db';
import { collectAllDaluxItems } from '../daluxPagination';

export interface DaluxUser {
  daluxUserId: string;
  email: string | null;
  name: string | null;
}

export interface LinkRow {
  accountId: string;
  daluxUserId: string;
  source: 'auto' | 'manual';
}

/** Users of every project the connection's API key can list (`GET /1.2/projects/{projectId}/users`). */
export async function fetchDaluxUsers(client: DaluxClient): Promise<DaluxUser[]> {
  const projects = await collectAllDaluxItems((params) => client.projects.listProjects(params));
  const users = new Map<string, DaluxUser>();
  for (const project of projects) {
    const items = await collectAllDaluxItems((params) => client.users.listProjectUsers(project.projectId, params));
    for (const user of items) {
      if (users.has(user.userId)) continue;
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
      users.set(user.userId, { daluxUserId: user.userId, email: user.email?.trim() || null, name: name || null });
    }
  }
  return [...users.values()];
}

function normalizeEmail(email: string | null): string | null {
  return email?.trim().toLowerCase() || null;
}

/**
 * Decides the automatic links of one connection: a personal account with
 * exactly one Dalux user of the same email (case-insensitive, trimmed) is
 * linked; with none or several its automatic link is removed. Accounts with a
 * manual link, and robots, are not matched.
 */
export function planLinks(
  accountRows: { id: string; type: 'personal' | 'robot'; email: string | null }[],
  users: DaluxUser[],
  links: LinkRow[],
): { link: { accountId: string; daluxUserId: string }[]; unlink: string[] } {
  const byEmail = new Map<string, string[]>();
  for (const user of users) {
    const email = normalizeEmail(user.email);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), user.daluxUserId]);
  }
  const current = new Map(links.map((row) => [row.accountId, row]));
  const link: { accountId: string; daluxUserId: string }[] = [];
  const unlink: string[] = [];
  for (const account of accountRows) {
    const existing = current.get(account.id);
    if (account.type !== 'personal' || existing?.source === 'manual') continue;
    const email = normalizeEmail(account.email);
    const matches = email ? byEmail.get(email) ?? [] : [];
    if (matches.length === 1) {
      if (existing?.daluxUserId !== matches[0]) link.push({ accountId: account.id, daluxUserId: matches[0] });
    } else if (existing) {
      unlink.push(account.id);
    }
  }
  return { link, unlink };
}

/** Re-matches one connection's accounts against its stored Dalux users. Cheap: no Dalux calls. */
export async function matchConnection(db: Db, connectionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [accountRows, users, links] = await Promise.all([
      tx.select({ id: accounts.id, type: accounts.type, email: accounts.email }).from(accounts),
      tx.select({ daluxUserId: daluxUsers.daluxUserId, email: daluxUsers.email, name: daluxUsers.name })
        .from(daluxUsers)
        .where(eq(daluxUsers.connectionId, connectionId)),
      tx.select({ accountId: daluxUserLinks.accountId, daluxUserId: daluxUserLinks.daluxUserId, source: daluxUserLinks.source })
        .from(daluxUserLinks)
        .where(eq(daluxUserLinks.connectionId, connectionId)),
    ]);
    const plan = planLinks(accountRows, users, links);
    for (const row of plan.link) {
      await tx
        .insert(daluxUserLinks)
        .values({ ...row, connectionId, source: 'auto' })
        .onConflictDoUpdate({
          target: [daluxUserLinks.accountId, daluxUserLinks.connectionId],
          set: { daluxUserId: row.daluxUserId, updatedAt: new Date() },
          // A manual link written since the read above wins.
          setWhere: eq(daluxUserLinks.source, 'auto'),
        });
    }
    for (const accountId of plan.unlink) {
      await tx
        .delete(daluxUserLinks)
        .where(and(eq(daluxUserLinks.accountId, accountId), eq(daluxUserLinks.connectionId, connectionId), eq(daluxUserLinks.source, 'auto')));
    }
  });
}

/** Copies the connection's Dalux users, then matches. Errors are stored on the connection for the interface. */
export async function syncConnectionUsers(db: Db, connectionId: string, clientFor: () => Promise<DaluxClient>): Promise<void> {
  let error: string | null = null;
  try {
    const users = await fetchDaluxUsers(await clientFor());
    await db.transaction(async (tx) => {
      await tx.delete(daluxUsers).where(eq(daluxUsers.connectionId, connectionId));
      if (users.length) await tx.insert(daluxUsers).values(users.map((user) => ({ ...user, connectionId })));
    });
    await matchConnection(db, connectionId);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  await db
    .update(connections)
    .set({ daluxUsersSyncedAt: new Date(), daluxUsersSyncError: error })
    .where(eq(connections.id, connectionId));
}

/** Connections never synced, synced over a day ago, or with a "Match now" newer than the last sync. */
export async function dueConnections(db: Db): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select id from connections
    where dalux_users_synced_at is null
       or dalux_users_synced_at <= now() - interval '1 day'
       or dalux_users_requested_at > dalux_users_synced_at`);
  return rows.map((row) => row.id);
}
