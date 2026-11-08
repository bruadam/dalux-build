import Link from 'next/link';
import { deleteAllMemoryAction, deleteMemoryAction, editMemoryAction, switchMemoryAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field, selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Cell, Table } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { citationLabel, listMemoryProjects, MEMORY_KINDS, viewMemory, writerLabel } from '@/lib/server/memory';
import { requireActor } from '@/lib/server/session';

type Search = { c?: string; p?: string; q?: string; kind?: string };

function Hidden({ connectionId, projectId }: { connectionId: string; projectId: string }) {
  return (
    <>
      <input type="hidden" name="connectionId" value={connectionId} />
      <input type="hidden" name="projectId" value={projectId} />
    </>
  );
}

export default async function MyMemoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireActor();
  const { c, p, q, kind } = await searchParams;
  const [projects, connections] = await Promise.all([listMemoryProjects(db(), actor.accountId), listConnections(db())]);
  const connectionName = (id: string) => connections.find((connection) => connection.id === id)?.name ?? id;
  const open = c && p ? await viewMemory(db(), actor, { connectionId: c, projectId: p, contains: q, kind }) : undefined;
  const exportLink = (format: 'json' | 'md', connectionId: string, projectId: string) =>
    `/memory/export?c=${encodeURIComponent(connectionId)}&p=${encodeURIComponent(projectId)}&format=${format}`;

  return (
    <>
      <PageHeader title="My memory">
        Notes that agents keep for you, per project. Only you can see them: admins cannot. Memory is off until you turn
        it on for a project. Turning it off keeps the entries. You need the <code>memory:read</code> and{' '}
        <code>memory:write</code> capabilities on the project; ask an admin if a project is missing.
      </PageHeader>

      <section className="mb-8 space-y-3">
        <Table head={['Connection', 'Project', 'Memory', 'Entries', '']} empty={!projects.length}>
          {projects.map((project) => (
            <tr key={`${project.connectionId}/${project.projectId}`}>
              <Cell>{connectionName(project.connectionId)}</Cell>
              <Cell>
                <code>{project.projectId}</code>
              </Cell>
              <Cell>
                <ActionForm action={switchMemoryAction}>
                  <Hidden connectionId={project.connectionId} projectId={project.projectId} />
                  <input type="hidden" name="enabled" value={String(!project.enabled)} />
                  <span className="mr-2">{project.enabled ? 'On' : 'Off'}</span>
                  <Button type="submit" variant="outline" size="sm">
                    Turn {project.enabled ? 'off' : 'on'}
                  </Button>
                </ActionForm>
              </Cell>
              <Cell>{project.entries}</Cell>
              <Cell className="space-x-3 whitespace-nowrap">
                <Link className="underline" href={`/memory?c=${project.connectionId}&p=${encodeURIComponent(project.projectId)}`}>
                  Open
                </Link>
                <a className="underline" href={exportLink('json', project.connectionId, project.projectId)}>
                  JSON
                </a>
                <a className="underline" href={exportLink('md', project.connectionId, project.projectId)}>
                  Markdown
                </a>
              </Cell>
            </tr>
          ))}
        </Table>
        <ActionForm action={switchMemoryAction}>
          <input type="hidden" name="enabled" value="true" />
          <Field label="Connection" htmlFor="memory-connection">
            <select id="memory-connection" name="connectionId" className={selectClass} required>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dalux project ID" htmlFor="memory-project">
            <Input id="memory-project" name="projectId" required />
          </Field>
          <Button type="submit">Turn memory on for a project</Button>
        </ActionForm>
      </section>

      {open && c && p && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-medium">
              {connectionName(c)} / <code>{p}</code>: {open.total} {open.total === 1 ? 'entry' : 'entries'}
            </h2>
            <ActionForm
              action={deleteAllMemoryAction}
              confirm="Delete every memory entry of this project, including old versions? This cannot be undone."
            >
              <Hidden connectionId={c} projectId={p} />
              <Button type="submit" variant="outline" size="sm">
                Delete all for this project
              </Button>
            </ActionForm>
          </div>
          <form className="flex flex-wrap items-end gap-2" action="/memory">
            <input type="hidden" name="c" value={c} />
            <input type="hidden" name="p" value={p} />
            <Field label="Text contains" htmlFor="memory-q">
              <Input id="memory-q" name="q" defaultValue={q} />
            </Field>
            <Field label="Kind" htmlFor="memory-kind">
              <select id="memory-kind" name="kind" defaultValue={kind ?? ''} className={selectClass}>
                <option value="">All</option>
                {MEMORY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          <Table head={['Kind', 'Entry', 'Written by', 'Updated', '']} empty={!open.entries.length}>
            {open.entries.map((entry) => (
              <tr key={entry.id}>
                <Cell>{entry.kind}</Cell>
                <Cell className="max-w-xl">
                  <p className="whitespace-pre-wrap">{entry.text}</p>
                  {entry.tags.length > 0 && <p className="text-xs text-muted-foreground">#{entry.tags.join(' #')}</p>}
                  {entry.citations.length > 0 && (
                    <p className="text-xs text-muted-foreground">Sources: {entry.citations.map(citationLabel).join('; ')}</p>
                  )}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs underline">Edit</summary>
                    <ActionForm action={editMemoryAction} className="mt-2">
                      <Hidden connectionId={c} projectId={p} />
                      <input type="hidden" name="id" value={entry.id} />
                      <textarea
                        name="text"
                        defaultValue={entry.text}
                        rows={4}
                        maxLength={2000}
                        className="w-full min-w-80 rounded-md border border-input bg-transparent p-2 text-sm"
                      />
                      <Button type="submit" size="sm">
                        Save as new version
                      </Button>
                    </ActionForm>
                  </details>
                </Cell>
                <Cell>{writerLabel(entry.source)}</Cell>
                <Cell className="whitespace-nowrap">{entry.updatedAt.toISOString().slice(0, 16).replace('T', ' ')}</Cell>
                <Cell>
                  <ActionForm action={deleteMemoryAction} confirm="Delete this entry and its old versions?">
                    <Hidden connectionId={c} projectId={p} />
                    <input type="hidden" name="id" value={entry.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Delete
                    </Button>
                  </ActionForm>
                </Cell>
              </tr>
            ))}
          </Table>
        </section>
      )}
    </>
  );
}
