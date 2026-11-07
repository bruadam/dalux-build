import { redirect } from 'next/navigation';
import { approveAuthorizationAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field, selectClass } from '@/components/field';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/server/db';
import { consentChoices, errorRedirect, parseAuthorizationRequest } from '@/lib/server/oauth';
import { currentActor } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** OAuth 2.1 authorization endpoint: sign in, choose a connection, approve (PRD 6.5 mode B). */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) params.set(key, Array.isArray(value) ? value[0] : value);
  const query = params.toString();

  const actor = await currentActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(`/authorize?${query}`)}`);

  const parsed = await parseAuthorizationRequest(db(), params);
  if ('error' in parsed) {
    if (parsed.redirect) redirect(parsed.redirect);
    return <Message title="Cannot connect this app">{parsed.error}</Message>;
  }
  const { request } = parsed;
  const app = request.clientName ?? 'An MCP client';
  const choices = (await consentChoices(db(), actor.accountId)).filter((c) => !request.connectionSlug || c.slug === request.connectionSlug);
  if (!choices.length) {
    const what = request.connectionSlug ? `the connection "${request.connectionSlug}"` : 'any connection';
    return (
      <Message title="No access">
        Your account has no access to {what}. Ask an admin for a grant.{' '}
        <a className="underline" href={errorRedirect(request.redirectUri, request.state, 'access_denied', 'No access')}>
          Return to {app}
        </a>
      </Message>
    );
  }
  const capabilities = [...new Set(choices.flatMap((c) => c.capabilities))].sort();

  return (
    <main className="mx-auto mt-16 max-w-lg space-y-6 px-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Connect {app}</h1>
        <p className="text-sm text-muted-foreground">
          <strong>{app}</strong> wants to use the Dalux MCP server as {actor.email ?? actor.name}. It returns to{' '}
          <code>{new URL(request.redirectUri).host}</code>. You can revoke it at any time under Connected apps.
        </p>
      </div>
      <ActionForm action={approveAuthorizationAction}>
        <input type="hidden" name="query" value={query} />
        <div className="w-full space-y-4">
          <Field label="Connection" htmlFor="consent-connection">
            <select id="consent-connection" name="connectionId" className={selectClass}>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="space-y-1 text-sm">
            <legend className="mb-1 font-medium">Access (uncheck to narrow it)</legend>
            {capabilities.map((capability) => (
              <label key={capability} className="flex items-center gap-2">
                <input type="checkbox" name="capabilities" value={capability} defaultChecked /> <code>{capability}</code>
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" name="decision" value="approve">
              Approve
            </Button>
            <Button type="submit" name="decision" value="deny" variant="outline">
              Deny
            </Button>
          </div>
        </div>
      </ActionForm>
    </main>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto mt-24 max-w-md space-y-2 px-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </main>
  );
}
