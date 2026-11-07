import { createGrantAction, deleteGrantAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field, selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { scopeLabel } from '@/components/scope';
import { Cell, Table } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CAPABILITIES, PRESETS } from '@/lib/capabilities';
import { listAccounts } from '@/lib/server/accounts';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { listGrants } from '@/lib/server/grants';
import { listGroups } from '@/lib/server/groups';
import { requireAdmin } from '@/lib/server/session';

export default async function GrantsPage() {
  await requireAdmin();
  const [grants, accounts, groups, connections] = await Promise.all([
    listGrants(db()),
    listAccounts(db()),
    listGroups(db()),
    listConnections(db()),
  ]);
  return (
    <>
      <PageHeader title="Grants">
        A grant gives an account or group capabilities on a connection or project. Admins get data access only through
        grants, like everyone else.
      </PageHeader>
      <section className="mb-8 space-y-2">
        <h2 className="font-medium">New grant</h2>
        <ActionForm action={createGrantAction}>
          <Field label="To" htmlFor="grant-principal">
            <select id="grant-principal" name="principal" className={selectClass} required>
              <optgroup label="Groups">
                {groups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Accounts">
                {accounts.map((a) => (
                  <option key={a.id} value={`account:${a.id}`}>
                    {a.name} {a.type === 'robot' ? '(robot)' : ''}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>
          <Field label="Connection" htmlFor="grant-connection">
            <select id="grant-connection" name="connectionId" className={selectClass} required>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Project ID (empty = whole connection)" htmlFor="grant-project">
            <Input id="grant-project" name="projectId" />
          </Field>
          <Field label="File area ID (optional)" htmlFor="grant-file-area">
            <Input id="grant-file-area" name="fileAreaId" />
          </Field>
          <Field label="Folder ID (optional)" htmlFor="grant-folder">
            <Input id="grant-folder" name="folderId" />
          </Field>
          <div className="basis-full space-y-2 text-sm">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" name="preset" value="reader" defaultChecked /> Reader preset ({PRESETS.reader.join(', ')})
            </label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {CAPABILITIES.map((capability) => (
                <label key={capability} className="flex items-center gap-1">
                  <input type="checkbox" name="capabilities" value={capability} /> <code>{capability}</code>
                </label>
              ))}
            </div>
            <p className="text-muted-foreground">File area and folder scopes keep only files:* capabilities.</p>
          </div>
          <Button type="submit">Save grant</Button>
        </ActionForm>
      </section>
      <Table head={['To', 'Connection', 'Scope', 'Capabilities', '']} empty={!grants.length}>
        {grants.map((grant) => (
          <tr key={grant.id}>
            <Cell>{grant.groupName ? `Group ${grant.groupName}` : grant.accountName}</Cell>
            <Cell>{grant.connectionName}</Cell>
            <Cell>{scopeLabel(grant)}</Cell>
            <Cell>
              <code className="text-xs">{grant.capabilities.join(', ')}</code>
            </Cell>
            <Cell>
              <ActionForm action={deleteGrantAction} confirm="Delete this grant?">
                <input type="hidden" name="grantId" value={grant.id} />
                <Button type="submit" variant="outline" size="sm">
                  Delete
                </Button>
              </ActionForm>
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}
