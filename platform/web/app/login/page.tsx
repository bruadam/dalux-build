import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/server/db';
import { currentActor } from '@/lib/server/session';
import { isEmptyInstall } from '@/lib/server/signup';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentActor()) redirect('/');
  const empty = await isEmptyInstall(db());
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-6 px-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <LoginForm />
      {empty && (
        <p className="text-sm text-muted-foreground">
          No accounts yet. <Link className="underline" href="/signup">Create the admin account</Link>.
        </p>
      )}
    </main>
  );
}
