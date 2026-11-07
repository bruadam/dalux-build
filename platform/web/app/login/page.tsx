import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/server/db';
import { currentActor } from '@/lib/server/session';
import { isEmptyInstall } from '@/lib/server/signup';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/** Only same-site paths, so `next` cannot send the browser elsewhere. */
function safeNext(next: string | undefined): string {
  return next?.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentActor()) redirect(next);
  const empty = await isEmptyInstall(db());
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-6 px-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <LoginForm next={next} />
      {empty && (
        <p className="text-sm text-muted-foreground">
          No accounts yet. <Link className="underline" href="/signup">Create the admin account</Link>.
        </p>
      )}
    </main>
  );
}
