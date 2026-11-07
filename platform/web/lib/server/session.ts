import 'server-only';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { accounts } from '@dalux-platform/db';
import { auth } from '../auth';
import type { Actor } from './actor';
import { db } from './db';

/** The signed-in account, or null. Disabled accounts count as signed out. */
export async function currentActor(): Promise<Actor | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  const accountId = (session?.user as { platformAccountId?: string } | undefined)?.platformAccountId;
  if (!accountId) return null;
  const [account] = await db().select().from(accounts).where(eq(accounts.id, accountId));
  if (account?.status !== 'active') return null;
  return { accountId: account.id, role: account.role, name: account.name, email: account.email };
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  return actor;
}

export async function requireAdmin(): Promise<Actor> {
  const actor = await requireActor();
  if (actor.role !== 'admin') redirect('/');
  return actor;
}
