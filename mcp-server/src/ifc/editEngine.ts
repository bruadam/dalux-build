/**
 * Applying caller-level edit operations to an edit session, with the AI
 * marking rule from ./aiMarking.ts enforced on every write.
 *
 * "Caller-level" is the important word. One operation here — set this
 * property on these 40 columns — becomes 80 entries in ifc-lite's mutation
 * history: the value, plus the `AI_Provenance` row recording it. Undo has to
 * work in the units the caller asked in, not in those, so each operation's
 * mutation count is journaled on the session and `undoOperations` converts
 * back. Without that, "undo the last change" reverts the provenance row and
 * leaves the edit in place, which is the worst of both.
 */
import type { PropertySetData } from '@ifc-lite/sdk';

import {
  applyValuePrefix,
  provenanceForAttribute,
  provenanceForDeleteProperty,
  provenanceForDeletePset,
  provenanceForSet,
  resolvePsetTarget,
  PROVENANCE_PSET,
  PROVENANCE_TIME_PROPERTY,
  PROVENANCE_TOOL_PROPERTY,
  type ProvenanceEntry,
  type PropertyValue,
} from './aiMarking';
import { assertWritable, mutationViewFor, pendingMutations, type EditSession } from './editSession';
import { buildEditToolContext, callIfcTool, loadIfcSdk } from './runtime';

/** Refuse a selector this wide rather than queue thousands of edits from one call. */
export const DEFAULT_MAX_ELEMENTS = 500;

export interface ElementSelector {
  globalIds?: string[];
  type?: string;
  where?: { pset: string; property: string; op: string; value?: string | number | boolean };
}

export type EditOperation =
  | { kind: 'set_property'; select: ElementSelector; pset: string; property: string; value: PropertyValue; markValue?: boolean }
  | { kind: 'delete_property'; select: ElementSelector; pset: string; property: string }
  | { kind: 'delete_pset'; select: ElementSelector; pset: string }
  | { kind: 'set_attribute'; select: ElementSelector; attribute: 'Name' | 'Description' | 'ObjectType' | 'Tag'; value: string }
  | { kind: 'undo'; count?: number };

export interface OperationResult {
  kind: EditOperation['kind'];
  ok: boolean;
  summary: string;
  elements?: number;
  /** Where each write actually landed, and why — the caller's evidence that marking happened. */
  marking?: { pset: string; marking: 'prefixed' | 'in-place'; renamedFrom?: string };
  valuePrefix?: { applied: boolean; skipped?: string };
  skipped?: string[];
  error?: string;
}

interface Target {
  globalId: string;
  expressId: number;
  type: string;
  name: string;
}

function psetsOf(session: EditSession, expressId: number): PropertySetData[] {
  return session.model.bim.properties({ modelId: session.model.id, expressId }) ?? [];
}

function currentValue(psets: PropertySetData[], pset: string, property: string): PropertyValue | undefined {
  const found = psets.find((p) => p.name === pset)?.properties.find((pr) => pr.name === property);
  return found ? found.value : undefined;
}

/** Resolve a selector to concrete, writable elements. */
export function resolveTargets(session: EditSession, select: ElementSelector, maxElements: number): Target[] {
  const hasQuery = select.type != null || select.where != null;
  if (!select.globalIds?.length && !hasQuery) {
    throw new Error('select needs either globalIds or a type (optionally narrowed by where).');
  }
  if (select.globalIds?.length && hasQuery) {
    throw new Error('select takes globalIds or a type/where query, not both — they would be ambiguous together.');
  }

  if (select.globalIds?.length) {
    // One pass over the model, not one per GlobalId: `toArray()` materialises
    // every entity, so scanning it inside the loop is quadratic and a 500-id
    // operation on a 10k-element model would walk five million rows.
    const byGlobalId = new Map(session.model.bim.query().toArray().map((e) => [e.globalId, e]));
    return select.globalIds.map((globalId) => {
      const entity = byGlobalId.get(globalId);
      if (!entity) throw new Error(`GlobalId not found in ${session.fileName}: ${globalId}`);
      assertWritable(session, globalId, entity.ref.expressId);
      return { globalId, expressId: entity.ref.expressId, type: entity.type, name: entity.name };
    });
  }

  let query = session.model.bim.query();
  if (select.type) query = query.byType(select.type);
  if (select.where) {
    query = query.where(select.where.pset, select.where.property, select.where.op as never, select.where.value);
  }
  const rows = query.toArray();
  if (rows.length > maxElements) {
    throw new Error(
      `Selector matches ${rows.length} elements, above the ${maxElements} cap for one operation. Narrow it with ` +
        '`where`, or raise maxElements deliberately once you have seen the count.',
    );
  }
  return rows.map((e) => ({ globalId: e.globalId, expressId: e.ref.expressId, type: e.type, name: e.name }));
}

/** Write the provenance rows for one element, plus the who/when stamp. */
async function writeProvenance(session: EditSession, expressId: number, entries: ProvenanceEntry[], at: Date): Promise<void> {
  const sdk = await loadIfcSdk();
  const view = mutationViewFor(session);
  for (const entry of entries) {
    view.setProperty(expressId, PROVENANCE_PSET, entry.name, entry.value, sdk.propertyValueTypeOf(entry.value));
  }
  view.setProperty(expressId, PROVENANCE_PSET, PROVENANCE_TOOL_PROPERTY, 'dalux-build-mcp / ifc_edit_apply', sdk.propertyValueTypeOf(''));
  view.setProperty(expressId, PROVENANCE_PSET, PROVENANCE_TIME_PROPERTY, at.toISOString(), sdk.propertyValueTypeOf(''));
}

async function applySetProperty(
  session: EditSession,
  op: Extract<EditOperation, { kind: 'set_property' }>,
  maxElements: number,
): Promise<OperationResult> {
  const sdk = await loadIfcSdk();
  const view = mutationViewFor(session);
  const targets = resolveTargets(session, op.select, maxElements);
  const at = new Date();

  let marking: OperationResult['marking'];
  let valuePrefix: OperationResult['valuePrefix'];

  for (const target of targets) {
    const psets = psetsOf(session, target.expressId);
    const resolved = resolvePsetTarget(psets.map((p) => p.name), op.pset);
    marking ??= resolved;

    let value = op.value;
    if (op.markValue) {
      const prefixed = applyValuePrefix(value);
      value = prefixed.value;
      valuePrefix ??= { applied: prefixed.prefixed, ...(prefixed.skipped ? { skipped: prefixed.skipped } : {}) };
    }

    const before = currentValue(psets, resolved.pset, op.property);
    view.setProperty(target.expressId, resolved.pset, op.property, value, sdk.propertyValueTypeOf(value));
    await writeProvenance(session, target.expressId, [provenanceForSet(resolved.pset, op.property, value, before, at)], at);
  }

  return {
    kind: op.kind,
    ok: true,
    elements: targets.length,
    marking,
    ...(valuePrefix ? { valuePrefix } : {}),
    summary: `Set ${marking?.pset ?? op.pset}.${op.property} on ${targets.length} element(s).`,
  };
}

async function applyDeleteProperty(
  session: EditSession,
  op: Extract<EditOperation, { kind: 'delete_property' }>,
  maxElements: number,
): Promise<OperationResult> {
  const view = mutationViewFor(session);
  const targets = resolveTargets(session, op.select, maxElements);
  const at = new Date();
  const skipped: string[] = [];
  let removed = 0;

  for (const target of targets) {
    const psets = psetsOf(session, target.expressId);
    const before = currentValue(psets, op.pset, op.property);
    if (before === undefined) {
      skipped.push(`${target.globalId}: no ${op.pset}.${op.property}`);
      continue;
    }
    view.deleteProperty(target.expressId, op.pset, op.property);
    await writeProvenance(session, target.expressId, [provenanceForDeleteProperty(op.pset, op.property, before, at)], at);
    removed++;
  }

  return {
    kind: op.kind,
    ok: true,
    elements: removed,
    ...(skipped.length ? { skipped } : {}),
    summary: `Deleted ${op.pset}.${op.property} from ${removed} element(s)` + (skipped.length ? `, ${skipped.length} did not carry it.` : '.'),
  };
}

async function applyDeletePset(
  session: EditSession,
  op: Extract<EditOperation, { kind: 'delete_pset' }>,
  maxElements: number,
): Promise<OperationResult> {
  const view = mutationViewFor(session);
  const targets = resolveTargets(session, op.select, maxElements);
  const at = new Date();
  const skipped: string[] = [];
  let removed = 0;

  for (const target of targets) {
    const psets = psetsOf(session, target.expressId);
    const existing = psets.find((p) => p.name === op.pset);
    if (!existing) {
      skipped.push(`${target.globalId}: no ${op.pset}`);
      continue;
    }
    // Names captured before the delete: once the set is gone the record is the
    // only thing left that says what was in it.
    const names = existing.properties.map((pr) => pr.name);
    view.deletePropertySet(target.expressId, op.pset);
    await writeProvenance(session, target.expressId, [provenanceForDeletePset(op.pset, names, at)], at);
    removed++;
  }

  return {
    kind: op.kind,
    ok: true,
    elements: removed,
    ...(skipped.length ? { skipped } : {}),
    summary: `Deleted property set ${op.pset} from ${removed} element(s)` + (skipped.length ? `, ${skipped.length} did not carry it.` : '.'),
  };
}

async function applySetAttribute(
  session: EditSession,
  op: Extract<EditOperation, { kind: 'set_attribute' }>,
  maxElements: number,
): Promise<OperationResult> {
  const view = mutationViewFor(session);
  const targets = resolveTargets(session, op.select, maxElements);
  const at = new Date();

  for (const target of targets) {
    const ref = { modelId: session.model.id, expressId: target.expressId };
    const before = session.model.bim.attributes(ref).find((a) => a.name === op.attribute);
    // `setAttribute` does not derive oldValue itself, and mutation_undo restores
    // from that field — so an undo of an unrecorded prior value restores nothing.
    const oldValue = before?.value != null ? String(before.value) : undefined;
    view.setAttribute(target.expressId, op.attribute, op.value, oldValue);
    await writeProvenance(session, target.expressId, [provenanceForAttribute(op.attribute, op.value, oldValue, at)], at);
  }

  return {
    kind: op.kind,
    ok: true,
    elements: targets.length,
    summary: `Set ${op.attribute} on ${targets.length} element(s).`,
  };
}

/**
 * Mutation types ifc-lite's `mutation_undo` knows how to invert.
 *
 * `DELETE_PROPERTY_SET` is deliberately absent: `MutablePropertyView` has no
 * inverse for it (reversing one means un-masking `deletedPsets` and dropping
 * the per-property DELETE markers it wrote, both private state), and
 * `mutation_undo` throws when it reaches one. It throws *mid-walk*, after
 * reverting the newer entries it already passed and before trimming the
 * history — so an unguarded undo across a `delete_pset` leaves the session
 * half-reverted with a history that no longer describes it. Hence the
 * up-front check in `undoOperations`: refuse, having changed nothing.
 */
const REVERTIBLE_MUTATIONS = new Set([
  'CREATE_PROPERTY',
  'UPDATE_PROPERTY',
  'DELETE_PROPERTY',
  'UPDATE_ATTRIBUTE',
  'CREATE_ENTITY',
  'DELETE_ENTITY',
]);

/**
 * Undo the last `count` caller operations — not the last `count` mutation
 * entries, which would strip provenance rows off edits that stayed.
 */
export async function undoOperations(session: EditSession, count: number): Promise<OperationResult> {
  const ops = session.ops;
  const undoable = Math.min(count, ops.length);
  if (undoable === 0) return { kind: 'undo', ok: true, summary: 'Nothing to undo.' };

  const target = ops.slice(ops.length - undoable);
  const mutations = target.reduce((sum, op) => sum + op.mutations, 0);

  const history = pendingMutations(session);
  const span = history.slice(history.length - mutations);
  const blocking = span.find((m) => !REVERTIBLE_MUTATIONS.has(String(m.type)));
  if (blocking) {
    const op = target.find((o) => o.kind === 'delete_pset') ?? target[0];
    throw new Error(
      `Cannot undo across operation ${op.n} ("${op.summary}"): ifc-lite has no inverse for a ` +
        `${String(blocking.type)} mutation, and attempting it would leave this session half-reverted. ` +
        'Nothing was changed. Either re-add the property set with set_property operations, or discard the ' +
        'session (ifc_edit_save with discard: true) and start again.',
    );
  }

  const ctx = await buildEditToolContext(session.registry, new AbortController().signal);
  await callIfcTool(ctx, 'mutation_undo', { model_id: session.model.id, n: mutations });
  ops.splice(ops.length - undoable, undoable);

  return {
    kind: 'undo',
    ok: true,
    summary: `Undid ${undoable} operation(s) (${mutations} underlying mutation(s)): ${target.map((o) => o.summary).join(' ')}`,
  };
}

/**
 * Run one operation and journal it. Not atomic across a batch — see
 * `applyOperations`'s caller in tools/ifc.ts.
 */
export async function applyOperation(
  session: EditSession,
  op: EditOperation,
  maxElements: number,
): Promise<OperationResult> {
  const before = pendingMutations(session).length;

  let result: OperationResult;
  switch (op.kind) {
    case 'set_property': result = await applySetProperty(session, op, maxElements); break;
    case 'delete_property': result = await applyDeleteProperty(session, op, maxElements); break;
    case 'delete_pset': result = await applyDeletePset(session, op, maxElements); break;
    case 'set_attribute': result = await applySetAttribute(session, op, maxElements); break;
    case 'undo': return undoOperations(session, op.count ?? 1);
  }

  const mutations = pendingMutations(session).length - before;
  session.ops.push({
    n: session.ops.length + 1,
    kind: op.kind,
    summary: result.summary,
    elements: result.elements ?? 0,
    mutations,
    at: Date.now(),
  });
  return result;
}
