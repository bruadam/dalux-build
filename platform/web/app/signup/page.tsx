import { redirect } from 'next/navigation';
import { db } from '@/lib/server/db';
import { currentActor } from '@/lib/server/session';
import { findInvite, isEmptyInstall } from '@/lib/server/signup';
import { SignupForm } from './signup-form';

export const dynamic = 'force-dynamic';

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  if (await currentActor()) redirect('/');
  const { invite } = await searchParams;
  const found = invite ? await findInvite(db(), invite) : undefined;
  const empty = !invite && (await isEmptyInstall(db()));

  return (
    <main className="mx-auto mt-24 max-w-sm space-y-6 px-4">
      <h1 className="text-xl font-semibold">{empty ? 'Create the admin account' : 'Accept your invite'}</h1>
      {found?.email ? (
        <SignupForm invite={invite} email={found.email} name={found.name} />
      ) : empty ? (
        <SignupForm />
      ) : (
        <p className="text-sm text-muted-foreground">
          Sign-up needs a valid invite link. Ask an admin for a new one.
        </p>
      )}
    </main>
  );
}
