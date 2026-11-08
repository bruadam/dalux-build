import {
  exportMemory,
  forgetAllMemory,
  forgetMemory,
  listMemory,
  MEMORY_KINDS,
  MEMORY_TEXT_MAX,
  reviseMemory,
  setMemoryEnabled,
  type Db,
  type MemoryEntry,
  type MemoryKind,
  type MemoryScope,
} from '@dalux-platform/db';
import type { Actor } from './actor';
import { UserError } from './errors';

export { listMemoryProjects } from '@dalux-platform/db';
export { MEMORY_KINDS, type MemoryEntry, type MemoryKind };

/**
 * The signed-in person's own memory (PRD 6.10). Every call runs as the `web` role with the person's account
 * id, so row-level security shows only their entries, and only while they hold memory:read / memory:write
 * and can read the project. Edits made here cannot be embedded (the web has no embedding key): the new
 * version is found by keywords until it is saved again through an agent.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const scopeOf = (actor: Actor, connectionId: string, projectId: string): MemoryScope => {
  if (!UUID.test(connectionId) || !projectId.trim()) throw new UserError('Choose a connection and a project');
  return { accountId: actor.accountId, connectionId, projectId: projectId.trim() };
};

/** The grant is missing or was withdrawn: the database refuses the change. */
async function asUserError<T>(change: () => Promise<T>): Promise<T> {
  try {
    return await change();
  } catch (error) {
    const message = (error as { cause?: Error }).cause?.message ?? (error as Error).message;
    if (message.includes('row-level security')) {
      throw new UserError('You need the memory:write capability and read access to this project. Ask an admin for a grant.');
    }
    throw error;
  }
}

export function switchMemory(db: Db, actor: Actor, input: { connectionId: string; projectId: string; enabled: boolean }) {
  return asUserError(() => setMemoryEnabled(db, scopeOf(actor, input.connectionId, input.projectId), input.enabled));
}

export function viewMemory(
  db: Db,
  actor: Actor,
  input: { connectionId: string; projectId: string; contains?: string; kind?: string },
) {
  const kind = MEMORY_KINDS.find((k) => k === input.kind);
  return listMemory(db, scopeOf(actor, input.connectionId, input.projectId), {
    contains: input.contains?.trim() || undefined,
    kind,
    limit: 100,
  });
}

export async function editMemoryEntry(db: Db, actor: Actor, input: { connectionId: string; projectId: string; id: string; text: string }) {
  const text = input.text.trim();
  if (!text) throw new UserError('The entry cannot be empty. Use Delete to remove it.');
  if (text.length > MEMORY_TEXT_MAX) throw new UserError(`An entry holds at most ${MEMORY_TEXT_MAX} characters`);
  const revised = await asUserError(() =>
    reviseMemory(db, scopeOf(actor, input.connectionId, input.projectId), input.id, { text, source: 'user', embedding: null }),
  );
  if (!revised) throw new UserError('This entry changed or was deleted. Reload the page.');
}

export async function deleteMemoryEntry(db: Db, actor: Actor, input: { connectionId: string; projectId: string; id: string }) {
  const deleted = await asUserError(() => forgetMemory(db, scopeOf(actor, input.connectionId, input.projectId), input.id));
  if (!deleted) throw new UserError('This entry was already deleted or changed. Reload the page.');
}

export function deleteAllMemory(db: Db, actor: Actor, input: { connectionId: string; projectId: string }) {
  return asUserError(() => forgetAllMemory(db, scopeOf(actor, input.connectionId, input.projectId)));
}

const WRITERS = [
  [/^user$/, () => 'You'],
  [/^agent:(.+)$/, (m: RegExpMatchArray) => `Agent ${m[1]}`],
  [/^hosted_agent:(.+)$/, (m: RegExpMatchArray) => `Hosted agent ${m[1]}`],
] as const;

/** Who wrote an entry, from its `source`. */
export function writerLabel(source: string): string {
  for (const [pattern, label] of WRITERS) {
    const match = source.match(pattern);
    if (match) return label(match);
  }
  return source;
}

export function citationLabel(citation: MemoryEntry['citations'][number]): string {
  const name = citation.fileName ?? citation.fileId ?? (citation.taskId ? `task ${citation.taskId}` : 'source');
  return citation.location ? `${name}, ${citation.location}` : name;
}

const KIND_TITLES: Record<MemoryKind, string> = {
  summary: 'Summary',
  fact: 'Facts',
  decision: 'Decisions',
  preference: 'Preferences',
  open_question: 'Open questions',
};

export function memoryJson(entries: MemoryEntry[], project: { connection: string; projectId: string }): string {
  const exported = entries.map(({ hasEmbedding: _embedding, ...entry }) => entry);
  return JSON.stringify({ exportedAt: new Date().toISOString(), ...project, entries: exported }, null, 2);
}

/** Current entries by kind, then the old versions, so the file reads like notes. */
export function memoryMarkdown(entries: MemoryEntry[], project: { connection: string; projectId: string }): string {
  const line = (entry: MemoryEntry) => {
    const cites = entry.citations.map(citationLabel).join('; ');
    const tags = entry.tags.length ? ` #${entry.tags.join(' #')}` : '';
    const meta = `${writerLabel(entry.source)}, ${entry.updatedAt.toISOString().slice(0, 10)}${cites ? `; ${cites}` : ''}`;
    return `- ${entry.text.replace(/\n+/g, ' ')}${tags} _(${meta})_`;
  };
  const current = entries.filter((entry) => !entry.supersededBy);
  const sections = MEMORY_KINDS.map((kind) => [kind, current.filter((entry) => entry.kind === kind)] as const)
    .filter(([, rows]) => rows.length)
    .map(([kind, rows]) => `## ${KIND_TITLES[kind]}\n\n${rows.map(line).join('\n')}`);
  const old = entries.filter((entry) => entry.supersededBy);
  if (old.length) sections.push(`## Older versions\n\n${old.map(line).join('\n')}`);
  return `# Memory: ${project.connection} / project ${project.projectId}\n\nExported ${new Date().toISOString()}.\n\n${sections.join('\n\n')}\n`;
}

export async function exportMemoryFile(
  db: Db,
  actor: Actor,
  input: { connectionId: string; projectId: string; connectionName: string; format: 'json' | 'md' },
) {
  const scope = scopeOf(actor, input.connectionId, input.projectId);
  const entries = await exportMemory(db, scope);
  const project = { connection: input.connectionName, projectId: scope.projectId };
  const safe = scope.projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return input.format === 'json'
    ? { filename: `memory-${safe}.json`, contentType: 'application/json', body: memoryJson(entries, project) }
    : { filename: `memory-${safe}.md`, contentType: 'text/markdown; charset=utf-8', body: memoryMarkdown(entries, project) };
}
