/**
 * Comparing two IFC models — two Dalux revisions of the same model, two
 * disciplines, or an open edit session against the file it was opened from.
 *
 * The classification itself is `@ifc-lite/diff`, reached through ifc-lite's
 * `model_diff` tool. Two things are added on top:
 *
 *   - **Both operands in one registry.** `model_diff` resolves `a` and `b`
 *     out of the context's registry, and this server keeps read models in a
 *     shared registry and each edit session in a private one. A throwaway
 *     registry holding exactly the two models under comparison is what lets
 *     any pair be compared without merging those lifetimes.
 *   - **Property-level deltas.** `model_diff` answers which entities changed
 *     and by how many, never *what* changed on one — and "modified" without
 *     the changed property is not actionable on a revision review. That is
 *     computed here, opt-in, because it extracts property sets for every
 *     common entity and that cost scales with the model.
 *
 * Scope is data-only, and says so: this server has no geometry pipeline
 * wired into the diff path, so a moved-but-otherwise-identical element reads
 * as unchanged. See `@ifc-lite/diff`'s own note on why the geometry hash
 * lives in WASM.
 */
import type { LoadedModel } from '@ifc-lite/mcp';
import type { PropertySetData } from '@ifc-lite/sdk';

import { buildToolContext, callIfcTool, loadIfcLite } from './runtime';

const NEVER_ABORT = new AbortController().signal;

export interface PropertyChange {
  path: string;
  change: 'added' | 'removed' | 'changed';
  base?: string | number | boolean | null;
  head?: string | number | boolean | null;
}

export interface ElementPropertyDelta {
  globalId: string;
  type: string;
  name: string;
  changes: PropertyChange[];
}

function psetMap(model: LoadedModel, expressId: number): Map<string, Map<string, string | number | boolean | null>> {
  const out = new Map<string, Map<string, string | number | boolean | null>>();
  let psets: PropertySetData[] = [];
  try {
    psets = model.bim.properties({ modelId: model.id, expressId }) ?? [];
  } catch {
    return out;
  }
  for (const pset of psets) {
    const props = out.get(pset.name) ?? new Map();
    for (const prop of pset.properties ?? []) props.set(prop.name, prop.value);
    out.set(pset.name, props);
  }
  return out;
}

/** GlobalId → express id, for one model. */
function indexByGlobalId(model: LoadedModel): Map<string, { expressId: number; type: string; name: string }> {
  const index = new Map<string, { expressId: number; type: string; name: string }>();
  for (const entity of model.bim.query().toArray()) {
    if (entity.globalId) index.set(entity.globalId, { expressId: entity.ref.expressId, type: entity.type, name: entity.name });
  }
  return index;
}

/**
 * Per-property differences for entities present in both models under the same
 * GlobalId.
 *
 * Only same-GlobalId pairs: a content match that `model_diff` resolved as a
 * re-GUID is the diff engine's judgement call, and attributing property
 * changes across one would present that judgement as fact. Those show up in
 * `contentDiff.contentMatches` instead.
 */
export function propertyDeltas(
  base: LoadedModel,
  head: LoadedModel,
  opts: { limit: number; type?: string },
): { deltas: ElementPropertyDelta[]; comparedElements: number; changedElements: number } {
  const baseIndex = indexByGlobalId(base);
  const headIndex = indexByGlobalId(head);

  const deltas: ElementPropertyDelta[] = [];
  let compared = 0;
  let changed = 0;

  for (const [globalId, headEntity] of headIndex) {
    const baseEntity = baseIndex.get(globalId);
    if (!baseEntity) continue;
    if (opts.type && headEntity.type !== opts.type) continue;
    compared++;

    const basePsets = psetMap(base, baseEntity.expressId);
    const headPsets = psetMap(head, headEntity.expressId);
    const changes: PropertyChange[] = [];

    for (const [psetName, headProps] of headPsets) {
      const baseProps = basePsets.get(psetName);
      for (const [propName, headValue] of headProps) {
        const path = `${psetName}.${propName}`;
        if (!baseProps || !baseProps.has(propName)) {
          changes.push({ path, change: 'added', head: headValue });
        } else {
          const baseValue = baseProps.get(propName) ?? null;
          if (baseValue !== headValue) changes.push({ path, change: 'changed', base: baseValue, head: headValue });
        }
      }
    }
    for (const [psetName, baseProps] of basePsets) {
      const headProps = headPsets.get(psetName);
      for (const [propName, baseValue] of baseProps) {
        if (!headProps || !headProps.has(propName)) {
          changes.push({ path: `${psetName}.${propName}`, change: 'removed', base: baseValue });
        }
      }
    }

    if (changes.length === 0) continue;
    changed++;
    // Counting continues past the cap so `changedElements` stays a whole
    // total — truncation must not be what makes a revision look clean.
    if (deltas.length < opts.limit) {
      deltas.push({ globalId, type: headEntity.type, name: headEntity.name, changes });
    }
  }

  return { deltas, comparedElements: compared, changedElements: changed };
}

export interface ModelDiffResult {
  typeDiffs: unknown;
  entityDiff: unknown;
  contentDiff: unknown;
  summary: string;
}

/** Run ifc-lite's `model_diff` over two models held in a registry of their own. */
export async function runModelDiff(
  base: LoadedModel,
  head: LoadedModel,
  opts: { byContent: boolean; byEntity: boolean },
): Promise<ModelDiffResult> {
  if (base.id === head.id) {
    throw new Error(`Both sides of the diff resolve to the same model ("${base.id}") — there is nothing to compare.`);
  }
  const ifc = await loadIfcLite();
  const registry = new ifc.InMemoryModelRegistry();
  registry.add(base);
  registry.add(head);

  const ctx = await buildToolContext(registry, NEVER_ABORT);
  const res = await callIfcTool(ctx, 'model_diff', {
    a: base.id,
    b: head.id,
    by_entity: opts.byEntity,
    by_content: opts.byContent,
  });

  return {
    summary: res.text,
    typeDiffs: res.data.typeDiffs,
    entityDiff: res.data.entityDiff,
    contentDiff: res.data.contentDiff,
  };
}
