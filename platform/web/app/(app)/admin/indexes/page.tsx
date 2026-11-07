import Link from 'next/link';
import { createIndexScopeAction, deleteIndexScopeAction, refreshIndexScopeAction, updateIndexScopeAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field, selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { dateTime, RunStatus } from '@/components/run-status';
import { Cell, Table } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { listIndexScopes } from '@/lib/server/indexScopes';
import { requireAdmin } from '@/lib/server/session';

export default async function IndexesPage() {
  await requireAdmin();
  const [scopes, connections] = await Promise.all([listIndexScopes(db()), listConnections(db())]);
  return (
    <>
      <PageHeader title="Indexes">
        The worker builds and refreshes these scopes on their schedule. A refresh only downloads and embeds files and tasks whose
        revision changed. Without an embedding key (Settings) indexes are lexical only.
      </PageHeader>
      <section className="mb-8 space-y-2">
        <h2 className="font-medium">New index scope</h2>
        <ActionForm action={createIndexScopeAction}>
          <Field label="Name" htmlFor="scope-name">
            <Input id="scope-name" name="name" required />
          </Field>
          <Field label="Connection" htmlFor="scope-connection">
            <select id="scope-connection" name="connectionId" className={selectClass} required>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kind" htmlFor="scope-kind">
            <select id="scope-kind" name="kind" className={selectClass}>
              <option value="file">Files (file area)</option>
              <option value="task">Tasks</option>
              <option value="docs">Docs (GitHub repository)</option>
            </select>
          </Field>
          <Field label="Every (hours)" htmlFor="scope-interval">
            <Input id="scope-interval" name="intervalHours" type="number" min="0.25" step="0.25" defaultValue="6" className="w-24" />
          </Field>
          <div className="basis-full text-xs text-muted-foreground">Files and tasks</div>
          <Field label="Project ID" htmlFor="scope-project">
            <Input id="scope-project" name="projectId" />
          </Field>
          <Field label="File area ID" htmlFor="scope-file-area">
            <Input id="scope-file-area" name="fileAreaId" />
          </Field>
          <Field label="Folder ID (optional)" htmlFor="scope-folder">
            <Input id="scope-folder" name="folderId" />
          </Field>
          <Field label="or folder path" htmlFor="scope-folder-path">
            <Input id="scope-folder-path" name="folderPath" />
          </Field>
          <Field label="Extensions (optional, e.g. .pdf .docx)" htmlFor="scope-extensions">
            <Input id="scope-extensions" name="extensions" />
          </Field>
          <label className="flex h-9 items-center gap-1 text-sm">
            <input type="checkbox" name="recursive" defaultChecked /> Subfolders
          </label>
          <label className="flex h-9 items-center gap-1 text-sm">
            <input type="checkbox" name="includeDrawings" defaultChecked /> Drawings
          </label>
          <Field label="Task type ID (optional)" htmlFor="scope-type">
            <Input id="scope-type" name="typeId" />
          </Field>
          <Field label="Task filter (optional)" htmlFor="scope-filter">
            <Input id="scope-filter" name="filter" />
          </Field>
          <div className="basis-full text-xs text-muted-foreground">Docs</div>
          <Field label="Repository owner" htmlFor="scope-owner">
            <Input id="scope-owner" name="owner" />
          </Field>
          <Field label="Repository" htmlFor="scope-repo">
            <Input id="scope-repo" name="repo" />
          </Field>
          <Field label="Ref (default main)" htmlFor="scope-ref">
            <Input id="scope-ref" name="ref" />
          </Field>
          <Field label="Path (default docs)" htmlFor="scope-path">
            <Input id="scope-path" name="path" />
          </Field>
          <Button type="submit">Add scope</Button>
        </ActionForm>
      </section>
      <Table head={['Name', 'Connection', 'Scope', 'Schedule', 'Last run', '']} empty={!scopes.length}>
        {scopes.map((scope) => (
          <tr key={scope.id}>
            <Cell>
              <Link href={`/admin/indexes/${scope.id}`} className="underline">
                {scope.name}
              </Link>
              <div className="text-xs text-muted-foreground">{scope.kind}</div>
            </Cell>
            <Cell>{scope.connectionName}</Cell>
            <Cell>
              <code className="text-xs break-all">{JSON.stringify(scope.scope)}</code>
            </Cell>
            <Cell>
              <ActionForm action={updateIndexScopeAction}>
                <input type="hidden" name="scopeId" value={scope.id} />
                <label className="flex items-center gap-1">
                  <input type="checkbox" name="enabled" defaultChecked={scope.enabled} /> on, every
                </label>
                <Input
                  name="intervalHours"
                  type="number"
                  min="0.25"
                  step="0.25"
                  defaultValue={scope.intervalMinutes / 60}
                  aria-label="Hours between refreshes"
                  className="w-20"
                />
                <span>h</span>
                <Button type="submit" variant="outline" size="sm">
                  Save
                </Button>
              </ActionForm>
            </Cell>
            <Cell>
              <RunStatus status={scope.lastRunStatus} />
              <div className="text-xs text-muted-foreground">{dateTime(scope.lastRunAt)}</div>
              {scope.refreshRequestedAt && (!scope.lastRunAt || scope.refreshRequestedAt > scope.lastRunAt) && (
                <div className="text-xs text-muted-foreground">refresh requested</div>
              )}
            </Cell>
            <Cell>
              <div className="flex gap-2">
                <ActionForm action={refreshIndexScopeAction}>
                  <input type="hidden" name="scopeId" value={scope.id} />
                  <Button type="submit" size="sm">
                    Refresh now
                  </Button>
                </ActionForm>
                <ActionForm action={deleteIndexScopeAction} confirm={`Delete the scope "${scope.name}" and its run history?`}>
                  <input type="hidden" name="scopeId" value={scope.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Delete
                  </Button>
                </ActionForm>
              </div>
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}
