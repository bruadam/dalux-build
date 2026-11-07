/**
 * Server half of the 3D viewer MCP App (see ../ui/ifcViewer.ts): geometry
 * chunks, element details, and named selections, all keyed by the resident
 * model from ./session.ts.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import type { LoadedModel } from '@ifc-lite/mcp';
import type { ToolContext } from '@ifc-lite/mcp';
import { packEncodedChunks } from './meshPack';
import { callIfcTool, loadIfcGeometry } from './runtime';
import { splitPath } from './catalogue';
import { currentCaller } from '../access/requestScope';

/**
 * Claude writes a tool result over ~150,000 characters to its code-execution
 * sandbox instead of handing it to the app, so the app never gets its data.
 * Every result the viewer app reads stays at or under this many characters of
 * serialized JSON.
 */
export const APP_RESULT_MAX_CHARS = 100_000;
/** base64(gzip) characters per geometry chunk; the rest of the result is a short envelope. */
const MAX_CHUNK_CHARS = 90_000;
/** Express ids per ifc_viewer_selection page (at most 11 characters each in JSON). */
export const SELECTION_PAGE_SIZE = 8_000;

export interface ViewerGeometry {
  types: string[];
  /** base64(gzip(chunk)) — see ./meshPack.ts for the layout. */
  chunks: string[];
  meshCount: number;
  triangleCount: number;
}

const geometryCache = new WeakMap<LoadedModel, Promise<ViewerGeometry>>();

async function buildViewerGeometry(model: LoadedModel): Promise<ViewerGeometry> {
  if (!model.filePath) throw new Error(`Model ${model.id} has no file path to mesh.`);
  const geometry = await loadIfcGeometry();
  // Flat path only: instanced geometry would never appear in `meshes`.
  const gp = new geometry.GeometryProcessor({ enableInstancing: false });
  try {
    await gp.init();
    const result = await gp.process(new Uint8Array(await readFile(model.filePath)));
    const packed = packEncodedChunks(result.meshes, MAX_CHUNK_CHARS, (chunk) => gzipSync(chunk).toString('base64'));
    return {
      types: packed.types,
      chunks: packed.chunks,
      meshCount: result.meshes.length,
      triangleCount: result.totalTriangles,
    };
  } finally {
    gp.dispose();
  }
}

/** Meshes and packs `model` once per resident model instance. */
export function viewerGeometry(model: LoadedModel): Promise<ViewerGeometry> {
  let cached = geometryCache.get(model);
  if (!cached) {
    cached = buildViewerGeometry(model);
    cached.catch(() => geometryCache.delete(model));
    geometryCache.set(model, cached);
  }
  return cached;
}

// ---------- element details ----------

export interface ElementDetails {
  expressId: number;
  type: string;
  name: string;
  globalId: string;
  description?: string;
  material?: string;
  /** Property sets and quantity sets, flattened to name → display value. */
  sets: { name: string; kind: 'pset' | 'qto'; values: Record<string, string | number | boolean | null> }[];
  /** Set when values were shortened or sets dropped to keep the result small. */
  truncated?: boolean;
}

interface RawSet {
  name: string;
  properties?: { name: string; value: unknown }[];
  quantities?: { name: string; value: unknown }[];
}

function toValues(items: { name: string; value: unknown }[] | undefined): ElementDetails['sets'][number]['values'] {
  const values: ElementDetails['sets'][number]['values'] = {};
  for (const item of items ?? []) {
    const v = item.value;
    values[item.name] = v === null || ['string', 'number', 'boolean'].includes(typeof v) ? (v as string | number | boolean | null) : JSON.stringify(v);
  }
  return values;
}

function materialName(materials: unknown): string | undefined {
  if (!materials || typeof materials !== 'object') return undefined;
  const m = materials as { name?: unknown; materials?: { name?: unknown }[]; layers?: { material?: { name?: unknown } }[] };
  if (typeof m.name === 'string') return m.name;
  const names = (m.materials ?? []).map((x) => x.name).concat((m.layers ?? []).map((l) => l.material?.name));
  const strings = names.filter((n): n is string => typeof n === 'string');
  return strings.length ? strings.join(', ') : undefined;
}

export async function elementDetails(ctx: ToolContext, model: LoadedModel, expressId: number): Promise<ElementDetails> {
  const res = await callIfcTool(ctx, 'get_entity', { model_id: model.id, express_id: expressId });
  const d = res.data as {
    globalId?: string; name?: string; type?: string; description?: string;
    properties?: RawSet[]; quantities?: RawSet[]; materials?: unknown;
  };
  return fitElementDetails({
    expressId,
    type: d.type ?? '',
    name: d.name ?? '',
    globalId: d.globalId ?? '',
    description: d.description || undefined,
    material: materialName(d.materials),
    sets: [
      ...(d.properties ?? []).map((s) => ({ name: s.name, kind: 'pset' as const, values: toValues(s.properties) })),
      ...(d.quantities ?? []).map((s) => ({ name: s.name, kind: 'qto' as const, values: toValues(s.quantities ?? s.properties) })),
    ],
  });
}

const MAX_VALUE_CHARS = 2_000;

/**
 * Keeps an element's details under `maxChars` of JSON: long values are cut
 * first, then trailing property sets are dropped and `truncated` is set.
 */
export function fitElementDetails(details: ElementDetails, maxChars = APP_RESULT_MAX_CHARS - 2_000): ElementDetails {
  const size = (d: ElementDetails) => JSON.stringify(d).length;
  if (size(details) <= maxChars) return details;
  const cut = (v: string) => (v.length > MAX_VALUE_CHARS ? `${v.slice(0, MAX_VALUE_CHARS)}…` : v);
  const fitted: ElementDetails = {
    ...details,
    description: details.description && cut(details.description),
    material: details.material && cut(details.material),
    sets: details.sets.map((set) => ({
      ...set,
      values: Object.fromEntries(Object.entries(set.values).map(([k, v]) => [cut(k), typeof v === 'string' ? cut(v) : v])),
    })),
    truncated: true,
  };
  while (fitted.sets.length > 0 && size(fitted) > maxChars) fitted.sets.pop();
  return fitted;
}

// ---------- selections ----------

export interface ElementFilter {
  type?: string;
  property?: { path: string; op: string; value?: string | number | boolean };
}

export interface SelectionSpec {
  filter?: ElementFilter;
  globalIds?: string[];
}

/** Short human label for a selection, shown on the viewer's filter chip. */
export function describeSelection(spec: SelectionSpec): string {
  const parts: string[] = [];
  if (spec.filter?.type) parts.push(spec.filter.type);
  const p = spec.filter?.property;
  if (p) parts.push(p.op === 'exists' ? `${p.path} exists` : `${p.path} ${p.op} ${String(p.value)}`);
  if (spec.globalIds?.length) parts.push(`${spec.globalIds.length} GlobalId${spec.globalIds.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'All elements';
}

const QUERY_PAGE = 10_000;

/** All express ids matching `filter` — ifc-lite's query_entities, paged past its 10k cap. */
export async function queryExpressIds(ctx: ToolContext, model: LoadedModel, filter: ElementFilter): Promise<number[]> {
  const base: Record<string, unknown> = { model_id: model.id, limit: QUERY_PAGE, fields: ['globalId'] };
  if (filter.type) base.type = filter.type;
  if (filter.property) {
    const parts = splitPath(filter.property.path);
    if (!parts) throw new Error(`property.path must be "Pset.Property", got "${filter.property.path}".`);
    base.property = {
      pset: parts.pset,
      name: parts.property,
      op: filter.property.op,
      ...(filter.property.op === 'exists' ? {} : { value: filter.property.value }),
    };
  }
  const ids: number[] = [];
  for (let offset = 0; ; offset += QUERY_PAGE) {
    const res = await callIfcTool(ctx, 'query_entities', { ...base, offset });
    const entities = (res.data.entities ?? []) as { expressId?: number; ref?: { expressId: number } }[];
    for (const e of entities) {
      const id = e.expressId ?? e.ref?.expressId;
      if (typeof id === 'number') ids.push(id);
    }
    if (entities.length < QUERY_PAGE) return ids;
  }
}

async function globalIdsToExpressIds(ctx: ToolContext, model: LoadedModel, globalIds: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < globalIds.length; i += 1000) {
    const res = await callIfcTool(ctx, 'get_entities_bulk', { model_id: model.id, global_ids: globalIds.slice(i, i + 1000), include: [] });
    const found = (res.data.entities ?? {}) as Record<string, { ref?: { expressId: number }; expressId?: number }>;
    for (const e of Object.values(found)) {
      const id = e.ref?.expressId ?? e.expressId;
      if (typeof id === 'number') ids.push(id);
    }
  }
  return ids;
}

/** Express ids for a selection spec: the filter's matches, narrowed to `globalIds` when both are given. */
export async function resolveSelectionSpec(ctx: ToolContext, model: LoadedModel, spec: SelectionSpec): Promise<number[]> {
  const byFilter = spec.filter ? await queryExpressIds(ctx, model, spec.filter) : undefined;
  const byGid = spec.globalIds?.length ? await globalIdsToExpressIds(ctx, model, spec.globalIds) : undefined;
  if (byFilter && byGid) {
    const keep = new Set(byGid);
    return byFilter.filter((id) => keep.has(id));
  }
  return byFilter ?? byGid ?? [];
}

export interface Selection {
  fileId: string;
  label: string;
  expressIds: number[];
}

const SELECTION_TTL_MS = 60 * 60_000;
const MAX_SELECTIONS = 200;
const selections = new Map<string, Selection & { owner: string | undefined; expiresAt: number }>();

/**
 * Stores a selection so tools can hand the viewer a short id instead of a long
 * id list. Process-local and restart-cleared, like ./session.ts's models; the
 * id is unguessable and every read is also checked against the caller's fileId
 * and owner (see currentCaller), so other callers get not-found.
 */
export function saveSelection(selection: Selection): string {
  const now = Date.now();
  for (const [id, s] of selections) if (s.expiresAt < now) selections.delete(id);
  while (selections.size >= MAX_SELECTIONS) selections.delete(selections.keys().next().value as string);
  const id = `sel_${randomBytes(9).toString('base64url')}`;
  selections.set(id, { ...selection, owner: currentCaller(), expiresAt: now + SELECTION_TTL_MS });
  return id;
}

export function getSelection(id: string, fileId: string): Selection | undefined {
  const s = selections.get(id);
  if (!s || s.expiresAt < Date.now() || s.fileId !== fileId || s.owner !== currentCaller()) return undefined;
  return { fileId: s.fileId, label: s.label, expressIds: s.expressIds };
}
