import { addConnectionAction, rotateConnectionKeyAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Cell, Table } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { requireAdmin } from '@/lib/server/session';

export default async function ConnectionsPage() {
  await requireAdmin();
  const connections = await listConnections(db());
  return (
    <>
      <PageHeader title="Connections">
        Dalux companies the platform reaches. The API key is checked with a read call, stored encrypted, and never shown again.
      </PageHeader>
      <section className="mb-8 space-y-2">
        <h2 className="font-medium">Add a connection</h2>
        <ActionForm action={addConnectionAction}>
          <Field label="Name" htmlFor="conn-name">
            <Input id="conn-name" name="name" required />
          </Field>
          <Field label="Slug (used in /mcp/c/<slug>)" htmlFor="conn-slug">
            <Input id="conn-slug" name="slug" pattern="[a-z0-9][a-z0-9-]*" required />
          </Field>
          <Field label="Dalux base URL" htmlFor="conn-url">
            <Input id="conn-url" name="baseUrl" type="url" placeholder="https://<company>.dalux.com/..." required />
          </Field>
          <Field label="API key" htmlFor="conn-key">
            <Input id="conn-key" name="apiKey" type="password" autoComplete="off" required />
          </Field>
          <Button type="submit">Verify and save</Button>
        </ActionForm>
      </section>
      <Table head={['Name', 'Slug', 'Base URL', 'API key', 'Rotate key']} empty={!connections.length}>
        {connections.map((connection) => (
          <tr key={connection.id}>
            <Cell>{connection.name}</Cell>
            <Cell>
              <code>{connection.slug}</code>
            </Cell>
            <Cell className="break-all">{connection.baseUrl}</Cell>
            <Cell>
              <code>…{connection.apiKeyLast4}</code>
            </Cell>
            <Cell>
              <ActionForm action={rotateConnectionKeyAction}>
                <input type="hidden" name="connectionId" value={connection.id} />
                <Input name="apiKey" type="password" autoComplete="off" aria-label="New API key" placeholder="New API key" required />
                <Button type="submit" variant="outline" size="sm">
                  Verify and rotate
                </Button>
              </ActionForm>
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}
