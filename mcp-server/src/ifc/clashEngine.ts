/**
 * Cross-model clash execution.
 *
 * ifc-lite's own clash_check/clash_matrix MCP tools (invoked elsewhere via
 * callIfcTool) mesh and clash exactly one model_id. That limit lives in the
 * tool wrapper, not the engine underneath: a `ClashElement` carries a `model`
 * field and `createClashEngine().run(elements, rules, …)` just takes a flat
 * element array, so it never assumes a single source model. Running N Dalux
 * files against each other (e.g. structure vs MEP exported as separate IFCs)
 * only requires meshing each one and concatenating the results before
 * handing them to the engine — the same two steps ifc-lite's clash.ts runs
 * for one model, repeated per model here.
 *
 * Assumes all input models already share one coordinate system (true for
 * disciplines split out of the same coordination model). No cross-model
 * alignment/transform is applied.
 */
import { readFile } from 'node:fs/promises';
import type { LoadedModel } from '@ifc-lite/mcp';
import type { ClashElement, ClashResult, ClashRule, ExclusionSet } from '@ifc-lite/clash';
import type { MeshData } from '@ifc-lite/geometry';
import type { ComparisonOp } from '@ifc-lite/sdk';
import { loadIfcClash, loadIfcClashStep, loadIfcGeometry } from './runtime';

/** Mesh cache keyed by LoadedModel instance, mirroring ifc-lite's own clash.ts cache. */
const meshCache = new WeakMap<LoadedModel, MeshData[]>();

async function meshModel(model: LoadedModel): Promise<MeshData[]> {
  const cached = meshCache.get(model);
  if (cached) return cached;

  if (!model.filePath) {
    throw new Error(`Model ${model.id} has no file path to mesh.`);
  }
  const bytes = await readFile(model.filePath);
  const geometry = await loadIfcGeometry();
  const gp = new geometry.GeometryProcessor();
  try {
    await gp.init();
    const result = await gp.process(bytes);
    if (result.meshes.length === 0) {
      throw new Error(
        `No mesh geometry could be produced for model ${model.id}; clash detection needs tessellated solids.`,
      );
    }
    meshCache.set(model, result.meshes);
    return result.meshes;
  } finally {
    gp.dispose();
  }
}

export interface CrossModelClashOptions {
  models: LoadedModel[];
  rules: ClashRule[];
  signal: AbortSignal;
  onProgress?: (phase: 'broad' | 'narrow', rule: string, done: number, total: number) => void;
}

/** Mesh every model, merge their elements and void/host exclusions, and run one clash pass over all of them. */
export async function runCrossModelClash(opts: CrossModelClashOptions): Promise<ClashResult> {
  const [clash, step] = await Promise.all([loadIfcClash(), loadIfcClashStep()]);

  const elements: ClashElement[] = [];
  // Exclusion entries are model-qualified pair keys (`qualifiedKey` namespaces
  // by model), so unioning sets from independently-meshed models is safe —
  // there is no risk of two models' element "42" colliding.
  const exclusions: ExclusionSet = new Set();
  for (const model of opts.models) {
    const meshes = await meshModel(model);
    const built = step.elementsFromStep({ store: model.store, meshes, modelId: model.id });
    elements.push(...built.elements);
    for (const key of built.exclusions) exclusions.add(key);
  }

  const engine = clash.createClashEngine({ backend: 'ts' });
  return engine.run(elements, opts.rules, {
    exclusions,
    signal: opts.signal,
    onProgress: opts.onProgress
      ? (p) => opts.onProgress!(p.phase, p.rule, p.done, p.total)
      : undefined,
  });
}

/** Resolve a property-filtered set of elements on one model to `clashMemberKey` strings for a rule's membersA/membersB. */
export async function resolveMembers(
  model: LoadedModel,
  type: string | undefined,
  filter: { pset: string; property: string; op: ComparisonOp; value?: string | number | boolean },
): Promise<string[]> {
  const clash = await loadIfcClash();
  let query = model.bim.query();
  if (type) query = query.byType(type);
  query = query.where(filter.pset, filter.property, filter.op, filter.value);
  return query.toArray().map((e) => clash.clashMemberKey(model.id, e.ref.expressId));
}
