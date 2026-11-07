/**
 * Isolated, in-memory edit sessions over a Dalux IFC.
 *
 * This is the one place in this server that queues writes onto a model, and it
 * deliberately does NOT reuse `session.ts`'s resident models. Those are keyed
 * by fileId alone and shared by every credential the process serves (the HTTP
 * transport runs one client per Dalux API key out of one process), so queueing
 * a mutation onto one would show every other caller reading that file an edit
 * they never made — and would silently change what `ifc_schedule` and
 * `ifc_query_elements` answer for them. An edit session therefore parses its
 * own private copy of the same cached download, under its own model id, in its
 * own registry.
 *
 * Nothing here touches Dalux. The edited model exists only in this process
 * until `saveEditSession` writes it to the local derived-artifact directory;
 * the original file in Dalux is never modified, and this server has no path
 * that would modify it.
 *
 * Authorization is re-checked against Dalux on every access, for the same
 * reason `session.ts` re-checks it: the session id is unguessable, but access
 * to the underlying file can be revoked while a session is open, and a
 * long-lived handle must not outlive the permission it was opened under.
 */
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';
import type { LoadedModel, ModelRegistry } from '@ifc-lite/mcp';

import { derivedDirFor } from '../cachePaths';
import { currentCaller } from '../access/requestScope';
import { loadIfcLite } from './runtime';
import { assertReadable, ensureLocalIfc, type IfcRef } from './session';

/**
 * Longer than the read cache's 30 minutes: dropping a resident read model
 * costs a re-parse, dropping an edit session costs the caller's queued work.
 * Still bounded — an edit session holds a whole second copy of the model.
 */
const IDLE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_RESIDENT = 3;

/**
 * One caller-level operation as applied. `mutations` is how many entries it
 * left in ifc-lite's mutation history — one edit plus its provenance rows —
 * which is what lets undo work in operations rather than in history entries.
 * See editEngine.ts.
 */
export interface AppliedOp {
  /** 1-based position in this session's operation journal. */
  n: number;
  kind: string;
  summary: string;
  elements: number;
  mutations: number;
  at: number;
}

export interface EditSession {
  /** Only this caller can use the session (see currentCaller). */
  owner?: string;
  id: string;
  ref: IfcRef;
  fileName: string;
  model: LoadedModel;
  registry: ModelRegistry;
  createdAt: number;
  lastUsed: number;
  /** Operation journal, oldest first — the unit undo and review both work in. */
  ops: AppliedOp[];
  /** Set once `saveEditSession` has written a file for this session. */
  lastSave?: { filePath: string; bytes: number; savedAt: number };
}

const sessions = new Map<string, EditSession>();

function evictIdle(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastUsed > IDLE_TTL_MS) sessions.delete(id);
  }
  while (sessions.size > MAX_RESIDENT) {
    let oldestId: string | null = null;
    let oldest = Infinity;
    for (const [id, session] of sessions) {
      if (session.lastUsed < oldest) { oldest = session.lastUsed; oldestId = id; }
    }
    if (!oldestId) break;
    sessions.delete(oldestId);
  }
}

/** Open a fresh edit session on `ref`. Downloads through the same cache the read tools use. */
export async function openEditSession(client: DaluxClient, ref: IfcRef): Promise<EditSession> {
  const filePath = await ensureLocalIfc(client, ref);
  const ifc = await loadIfcLite();

  const id = randomUUID();
  // A model id distinct from `session.ts`'s (which uses the bare fileId), so
  // the two never collide in any registry or mesh cache.
  const model = await ifc.loadIfcModel(filePath, { modelId: `edit-${id}` });
  const registry = new ifc.InMemoryModelRegistry();
  registry.add(model);

  const session: EditSession = {
    id,
    owner: currentCaller(),
    ref,
    fileName: path.basename(filePath),
    model,
    registry,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    ops: [],
  };
  sessions.set(id, session);
  evictIdle();
  return session;
}

/**
 * Look up an open session, re-checking with Dalux that this caller may still
 * read the file behind it.
 */
export async function getEditSession(client: DaluxClient, id: string): Promise<EditSession> {
  const session = sessions.get(id);
  if (!session || session.owner !== currentCaller()) {
    throw new Error(
      `Unknown editId "${id}". Edit sessions live in this server's memory only — they are dropped after ` +
        `${IDLE_TTL_MS / 3_600_000}h idle, when the process restarts, or when discarded. Queued edits are not ` +
        'persisted; start again with ifc_edit_start.',
    );
  }
  await assertReadable(client, session.ref);
  session.lastUsed = Date.now();
  return session;
}

/** Drop a session and everything queued on it. */
export function discardEditSession(id: string): boolean {
  return sessions.delete(id);
}

/** The mutation overlay for a session, created on first use. */
export function mutationViewFor(session: EditSession) {
  const backend = session.model.backend;
  backend.ensureEditor();
  const view = backend.getMutationView();
  if (!view) throw new Error('ifc-lite did not provide a mutation view for this model.');
  return view;
}

/**
 * Refuse a write to an entity this model does not actually hold.
 *
 * Mirrors ifc-lite's own `resolveWritableExpressId`: writing through the
 * mutation view directly bypasses the guard on `bim.mutate.*`, and an
 * unchecked write to an id the model does not hold is accepted by the overlay,
 * reported as queued, and then dropped by the exporter with no diagnostic
 * anywhere in the round trip.
 */
export function assertWritable(session: EditSession, globalId: string, expressId: number): void {
  const reason = session.model.backend.checkEntityRef({ modelId: session.model.id, expressId });
  if (reason !== null) throw new Error(`Cannot write to ${globalId} (#${expressId}): ${reason}`);
}

/** Pending mutations recorded on this session, oldest first. */
export function pendingMutations(session: EditSession): Array<Record<string, unknown>> {
  const view = session.model.backend.getMutationView();
  if (!view) return [];
  return ((view as unknown as { mutationHistory?: Array<Record<string, unknown>> }).mutationHistory ?? []).slice();
}

/**
 * Export the session's model, mutations baked in, to the derived-artifact
 * directory for the source file.
 *
 * `bim.export.ifc(undefined, …)` — `undefined`, not an empty ref list, which
 * ifc-lite reads as "isolate nothing" and would export an empty file.
 */
export async function saveEditSession(session: EditSession, fileNameHint?: string): Promise<{ filePath: string; bytes: number; schema: string }> {
  const schema = session.model.store.schemaVersion;
  // ifc-lite's STEP exporter writes IFC2X3 / IFC4 / IFC4X3. IFC5 parses but has
  // no STEP serialization, so there is no honest file to write — refusing beats
  // exporting it as IFC4 and handing back something that claims a schema it was
  // not authored in.
  if (schema !== 'IFC2X3' && schema !== 'IFC4' && schema !== 'IFC4X3') {
    throw new Error(`${session.fileName} is ${schema}, which ifc-lite's STEP exporter cannot write. Edits cannot be saved for this model.`);
  }
  const content = session.model.bim.export.ifc(undefined, { schema });
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);

  const base = (fileNameHint ?? session.fileName).replace(/\.ifc$/i, '');
  const filePath = path.join(derivedDirFor(session.ref.fileId), `${sanitize(base)}-AI-edited-${Date.now()}.ifc`);
  await writeFile(filePath, text, 'utf-8');

  const bytes = Buffer.byteLength(text, 'utf-8');
  session.lastSave = { filePath, bytes, savedAt: Date.now() };
  return { filePath, bytes, schema };
}

/** Keep a caller-supplied name from escaping the derived directory or tripping the filesystem. */
function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 120) || 'model';
}
