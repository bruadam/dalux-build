/**
 * IFC analysis and editing tools over models pulled from Dalux.
 *
 * Every tool is keyed by Dalux identifiers (projectId / fileAreaId / fileId) —
 * callers never see or supply a local cache path. The model is downloaded and
 * parsed on first use and kept resident (see ../ifc/session.ts).
 *
 * This surface is deliberately narrow. ifc-lite ships 85 tools, and because we
 * invoke handlers directly its scope gating never runs — so what is re-exported
 * here is the only boundary.
 *
 * **Everything except the ifc_edit_* group is read-only, and the edit group is
 * read-only with respect to Dalux.** An edit session mutates a private,
 * in-process parse of a downloaded file (../ifc/editSession.ts) and
 * ifc_edit_save writes a NEW local .ifc. No tool here writes to Dalux, and the
 * client's upload API is deliberately not reachable from this module — putting
 * an edited revision back into the project is a manual step the user takes.
 *
 * Every write is marked as AI-authored in the exported file itself; that rule
 * is not a caller option. See ../ifc/aiMarking.ts for what it does and why it
 * does not simply prefix values.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import type { ClashRule } from '@ifc-lite/clash';
import type { LoadedModel } from '@ifc-lite/mcp';
import type { ComparisonOp } from '@ifc-lite/sdk';

import { derivedDirFor } from '../cachePaths';
import { createDownloadLink } from '../downloadLinks';
import { AI_PSET_PREFIX, PROVENANCE_PSET } from '../ifc/aiMarking';
import { buildCatalogue, splitPath, validateColumns } from '../ifc/catalogue';
import { resolveMembers } from '../ifc/clashEngine';
import { describeJob, getClashJob, startClashJob, COMMONLY_DOMINANT_TYPES } from '../ifc/clashJobs';
import { propertyDeltas, runModelDiff } from '../ifc/diffEngine';
import { applyOperation, DEFAULT_MAX_ELEMENTS, type EditOperation, type OperationResult } from '../ifc/editEngine';
import {
  discardEditSession,
  getEditSession,
  openEditSession,
  pendingMutations,
  saveEditSession,
} from '../ifc/editSession';
import { buildToolContext, callIfcTool } from '../ifc/runtime';
import { deleteRule, getRules, listRules, saveRule } from '../ifc/ruleCatalog';
import { resolveModel, type ResolvedModel } from '../ifc/session';
import { describeVolumeJob, getVolumeJob, startVolumeJob } from '../ifc/volumeJobs';
import { describeSelection, queryExpressIds, saveSelection } from '../ifc/viewerData';

const ifcRef = {
  projectId: z.string(),
  fileAreaId: z.string(),
  fileId: z.string().describe('The file ID of an .ifc file.'),
};

const NEVER_ABORT = new AbortController().signal;

async function open(client: DaluxClient, args: { projectId: string; fileAreaId: string; fileId: string }) {
  const resolved = await resolveModel(client, args);
  const ctx = await buildToolContext(resolved.registry, NEVER_ABORT);
  return { ...resolved, ctx };
}

// ---------- ifc_model_info ----------

export const ifcModelInfoInput = z.object({ ...ifcRef });
export type IfcModelInfoInput = z.infer<typeof ifcModelInfoInput>;

/** Downloads/parses the IFC and summarises it: size, units, types, materials. */
export async function ifcModelInfo(client: DaluxClient, args: IfcModelInfoInput) {
  const { model, fileName, ctx } = await open(client, args);
  const info = await callIfcTool(ctx, 'model_info', { model_id: model.id });
  const counts = await callIfcTool(ctx, 'count_entities', { model_id: model.id, group_by: 'type' });
  const materials = await callIfcTool(ctx, 'materials_list', { model_id: model.id });
  const units = await callIfcTool(ctx, 'units', { model_id: model.id });
  const cat = buildCatalogue(model);

  return {
    fileName,
    modelId: model.id,
    summary: info.text,
    units: units.text,
    typeCounts: counts.data.groups ?? counts.text,
    materials: materials.data.materials ?? materials.text,
    propertyCoverage: {
      totalProducts: cat.totalProducts,
      productsWithProperties: cat.productsWithProperties,
      note:
        cat.productsWithProperties === 0
          ? 'No product in this model carries a property set; quantity and schedule requests cannot be answered from properties.'
          : undefined,
    },
  };
}

// ---------- ifc_discover_properties ----------

export const ifcDiscoverPropertiesInput = z.object({
  ...ifcRef,
  type: z.string().optional().describe('Restrict to one IFC type, e.g. "IfcColumn".'),
  maxTypes: z.number().int().min(1).max(50).optional().describe('Max types to return (default 10, largest first).'),
});
export type IfcDiscoverPropertiesInput = z.infer<typeof ifcDiscoverPropertiesInput>;

/**
 * Lists the property sets and properties each element type actually carries,
 * with per-property coverage counts. Call this before ifc_schedule or
 * ifc_property_values: pset naming is exporter-specific ("Tekla Quantity",
 * "i-Theses TSB_PlateBase", "ColumnBaseQuantities"), and guessing a name
 * yields blank columns rather than an error.
 */
export async function ifcDiscoverProperties(client: DaluxClient, args: IfcDiscoverPropertiesInput) {
  const { model, fileName } = await open(client, args);
  const cat = buildCatalogue(model);
  const types = (args.type ? cat.types.filter((t) => t.type === args.type) : cat.types).slice(0, args.maxTypes ?? 10);

  return {
    fileName,
    totalProducts: cat.totalProducts,
    productsWithProperties: cat.productsWithProperties,
    types: types.map((t) => ({
      type: t.type,
      elementCount: t.elementCount,
      withProperties: t.withProperties,
      psets: t.psets.map((p) => ({
        pset: p.name,
        properties: p.properties.map((pr) => ({
          path: `${p.name}.${pr.name}`,
          coverage: `${pr.count}/${t.elementCount}`,
          valueType: pr.valueType,
          sample: pr.sample,
        })),
      })),
    })),
  };
}

// ---------- ifc_property_values ----------

export const ifcPropertyValuesInput = z.object({
  ...ifcRef,
  type: z.string().describe('IFC type, e.g. "IfcColumn".'),
  property: z.string().describe('Full "Pset.Property" path, e.g. "Tekla Quantity.Weight".'),
});
export type IfcPropertyValuesInput = z.infer<typeof ifcPropertyValuesInput>;

/** Value histogram for one property across a type — useful before filtering. */
export async function ifcPropertyValues(client: DaluxClient, args: IfcPropertyValuesInput) {
  const { model, ctx } = await open(client, args);
  const parts = splitPath(args.property);
  if (!parts) throw new Error(`property must be a "Pset.Property" path, got "${args.property}".`);
  const invalid = validateColumns(buildCatalogue(model), args.type, [args.property]);
  if (invalid) throw new Error(invalid);

  const res = await callIfcTool(ctx, 'properties_unique', {
    model_id: model.id,
    type: args.type,
    pset: parts.pset,
    property: parts.property,
  });
  return { type: args.type, property: args.property, values: res.data.values ?? res.text };
}

// ---------- ifc_query_elements ----------

export const ifcQueryElementsInput = z.object({
  ...ifcRef,
  type: z.string().optional().describe('IFC type, e.g. "IfcColumn". Includes subtypes.'),
  property: z
    .object({
      path: z.string().describe('Full "Pset.Property" path, e.g. "Tekla Quantity.Weight".'),
      op: z.enum(['=', '!=', '>', '<', '>=', '<=', 'contains', 'exists', 'matches']),
      value: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Omit only for "exists".'),
    })
    .optional()
    .describe('Property filter. Handles pset/property names containing spaces.'),
  limit: z.number().int().min(1).max(500).optional().describe('Max elements to return (default 50).'),
});
export type IfcQueryElementsInput = z.infer<typeof ifcQueryElementsInput>;

/**
 * Filter elements by type and/or a property comparison.
 *
 * Uses ifc-lite's structured filter rather than its selector-string grammar,
 * which cannot express names containing spaces — and most quantity data in
 * Dalux exports lives in psets like "Tekla Quantity".
 */
export async function ifcQueryElements(client: DaluxClient, args: IfcQueryElementsInput) {
  const { model, ctx } = await open(client, args);
  const input: Record<string, unknown> = { model_id: model.id, limit: args.limit ?? 50 };
  if (args.type) input.type = args.type;

  if (args.property) {
    const parts = splitPath(args.property.path);
    if (!parts) throw new Error(`property.path must be "Pset.Property", got "${args.property.path}".`);
    const invalid = validateColumns(buildCatalogue(model), args.type, [args.property.path]);
    if (invalid) throw new Error(invalid);
    input.property = {
      pset: parts.pset,
      name: parts.property,
      op: args.property.op,
      ...(args.property.op === 'exists' ? {} : { value: args.property.value }),
    };
  }

  const res = await callIfcTool(ctx, 'query_entities', input);
  const matched = res.data.total ?? res.data.count;
  // A server-side handle on the full match set, so view_model_3d can show it without an id list.
  const expressIds = await queryExpressIds(ctx, model, { type: args.type, property: args.property });
  const selectionId = expressIds.length
    ? saveSelection({ fileId: args.fileId, label: describeSelection({ filter: { type: args.type, property: args.property } }), expressIds })
    : undefined;
  return { matched, selectionId, entities: res.data.entities ?? res.text };
}

// ---------- ifc_schedule ----------

export const ifcScheduleInput = z.object({
  ...ifcRef,
  type: z.string().describe('IFC type to tabulate, e.g. "IfcColumn".'),
  columns: z
    .array(z.string())
    .min(1)
    .describe('Columns: plain attributes (GlobalId, Name, Type) or "Pset.Property" paths from ifc_discover_properties.'),
  previewRows: z.number().int().min(1).max(50).optional().describe('Rows to inline in the response (default 10).'),
});
export type IfcScheduleInput = z.infer<typeof ifcScheduleInput>;

/**
 * Build a schedule / quantity table and write it to CSV.
 *
 * This is the quantity-takeoff path. It does NOT use ifc-lite's
 * geometry_volume / geometry_area, which read only IfcElementQuantity — none
 * of the Dalux models tested carry one. Quantities live in vendor property
 * sets instead, so columns are taken as explicit "Pset.Property" paths and
 * validated first.
 *
 * Values are in file units: Dalux exports are typically millimetres, so a
 * "Length" of 10500 means 10.5 m. See ifc_model_info for the unit scale.
 */
export async function ifcSchedule(client: DaluxClient, args: IfcScheduleInput) {
  const { model, fileName, ctx } = await open(client, args);
  const invalid = validateColumns(buildCatalogue(model), args.type, args.columns);
  if (invalid) throw new Error(invalid);

  const res = await callIfcTool(ctx, 'export_csv', {
    model_id: model.id,
    type: args.type,
    columns: args.columns,
  });
  const csv = typeof res.data.csv === 'string' ? res.data.csv : '';
  const lines = csv.split('\n').filter((l) => l.length > 0);
  const previewRows = args.previewRows ?? 10;

  const outPath = path.join(derivedDirFor(args.fileId), `schedule-${args.type}-${Date.now()}.csv`);
  await writeFile(outPath, csv, 'utf-8');

  return {
    fileName,
    type: args.type,
    columns: args.columns,
    rows: Math.max(lines.length - 1, 0),
    csvPath: outPath,
    preview: lines.slice(0, previewRows + 1),
    note: 'Values are in the file\'s own units (Dalux IFC exports are usually millimetres). Full table written to csvPath.',
  };
}

// ---------- ifc_clash_rules_list / _save / _delete ----------

export const ifcClashRulesListInput = z.object({});
export type IfcClashRulesListInput = z.infer<typeof ifcClashRulesListInput>;

/** List the clash rule catalog: ifc-lite's built-in discipline matrix plus any custom rules saved so far. */
export async function ifcClashRulesList(_client: DaluxClient, _args: IfcClashRulesListInput) {
  const rules = await listRules();
  return { rules };
}

export const ifcClashRulesSaveInput = z.object({
  id: z.string().optional().describe('Rule id to update. Omit to create a new rule (id is derived from name). May match a built-in id to override it.'),
  name: z.string().describe('Rule name, e.g. "MEP vs Structure" or "VENTxSTR".'),
  description: z.string().optional(),
  a: z.string().describe('Type selector for set A, e.g. "IfcDuct*|IfcPipe*".'),
  b: z.string().optional().describe('Type selector for set B. Omit for a self-clash within A.'),
  mode: z.enum(['hard', 'clearance']).optional().describe('hard = interpenetration (default); clearance = minimum gap.'),
  tolerance: z.number().optional().describe('Penetration tolerance in metres (hard mode).'),
  clearance: z.number().optional().describe('Required gap in metres (clearance mode).'),
  severity: z.enum(['critical', 'major', 'minor', 'info']).optional(),
  reportTouch: z.boolean().optional().describe('Report touch-classified results instead of suppressing them.'),
});
export type IfcClashRulesSaveInput = z.infer<typeof ifcClashRulesSaveInput>;

/** Save (create or update) a custom rule in the persistent clash rule catalog. */
export async function ifcClashRulesSave(_client: DaluxClient, args: IfcClashRulesSaveInput) {
  return { saved: saveRule(args) };
}

export const ifcClashRulesDeleteInput = z.object({
  id: z.string().describe('Id of the custom rule to delete (see ifc_clash_rules_list). Built-in rules cannot be deleted.'),
});
export type IfcClashRulesDeleteInput = z.infer<typeof ifcClashRulesDeleteInput>;

export async function ifcClashRulesDelete(_client: DaluxClient, args: IfcClashRulesDeleteInput) {
  const ok = deleteRule(args.id);
  if (!ok) throw new Error(`No custom rule with id "${args.id}" (built-in rules can be overridden via ifc_clash_rules_save with the same id, but not deleted).`);
  return { deleted: args.id };
}

// ---------- ifc_clash_start / ifc_clash_result ----------

const propertyFilter = z.object({
  path: z.string().describe('Full "Pset.Property" path, e.g. "Tekla Quantity.Weight".'),
  op: z.enum(['=', '!=', '>', '<', '>=', '<=', 'contains', 'exists', 'matches']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Omit only for "exists".'),
});

export const ifcClashStartInput = z.object({
  projectId: z.string(),
  models: z
    .array(z.object({ fileAreaId: z.string(), fileId: z.string().describe('The file ID of an .ifc file.') }))
    .min(1)
    .describe(
      'IFC files to clash, all from projectId. One entry self-clashes/pairwise-clashes within that model. ' +
        'Two or more clash ACROSS models too (e.g. a structure IFC vs a separately-exported MEP IFC) — assumes ' +
        'they already share one coordinate system.',
    ),
  ruleIds: z.array(z.string()).optional().describe('Catalog rule ids to run (see ifc_clash_rules_list, e.g. the built-in "MEPxSTR"). Combine with `rule` for an ad-hoc rule in the same run.'),
  rule: z
    .object({
      name: z.string().optional(),
      a: z.string().optional().describe('Type selector for set A, e.g. "IfcDuct*|IfcPipe*". Defaults to all elements.'),
      aFilter: propertyFilter.optional().describe('Restrict side A further by a property value. Requires `a` to be one exact IFC type (no "*"/"|"), since the filter is resolved per-type against each model\'s own property sets.'),
      b: z.string().optional().describe('Type selector for set B. Omit to self-clash within A.'),
      bFilter: propertyFilter.optional().describe('Restrict side B further by a property value. Requires `b` to be one exact IFC type.'),
      mode: z.enum(['hard', 'clearance']).optional().describe('hard = interpenetration (default); clearance = minimum gap.'),
      tolerance: z.number().optional().describe('Penetration tolerance in metres (hard mode).'),
      clearance: z.number().optional().describe('Required gap in metres (clearance mode).'),
    })
    .optional()
    .describe('One ad-hoc rule, in addition to or instead of ruleIds.'),
});
export type IfcClashStartInput = z.infer<typeof ifcClashStartInput>;

async function resolveFilterMembers(
  models: ResolvedModel[],
  type: string,
  filter: { path: string; op: ComparisonOp; value?: string | number | boolean },
): Promise<string[]> {
  if (/[*|!]/.test(type)) {
    throw new Error(`Property filters need one exact IFC type, not a selector: got "${type}".`);
  }
  const parts = splitPath(filter.path);
  if (!parts) throw new Error(`property.path must be "Pset.Property", got "${filter.path}".`);

  const members: string[] = [];
  for (const { model } of models) {
    const cat = buildCatalogue(model);
    if (!cat.types.some((t) => t.type === type)) continue; // this model just has none of that type
    const invalid = validateColumns(cat, type, [filter.path]);
    if (invalid) throw new Error(`[model ${model.id}] ${invalid}`);
    members.push(...(await resolveMembers(model, type, { pset: parts.pset, property: parts.property, op: filter.op, value: filter.value })));
  }
  return members;
}

async function buildAdHocRule(models: ResolvedModel[], rule: NonNullable<IfcClashStartInput['rule']>): Promise<ClashRule> {
  const a = rule.a ?? '*';
  const b = rule.b;
  const label = rule.name ?? (b ? `${a} vs ${b}` : a === '*' ? 'all elements (self-clash)' : `${a} (self-clash)`);

  const clashRule: ClashRule = {
    id: 'ad-hoc',
    name: label,
    a,
    ...(b != null ? { b } : {}),
    mode: rule.mode ?? 'hard',
    ...(rule.tolerance != null ? { tolerance: rule.tolerance } : {}),
    ...(rule.clearance != null ? { clearance: rule.clearance } : {}),
  };

  if (rule.aFilter) clashRule.membersA = await resolveFilterMembers(models, a, rule.aFilter);
  if (rule.bFilter) {
    if (!b) throw new Error('rule.bFilter requires rule.b (a type selector for side B).');
    clashRule.membersB = await resolveFilterMembers(models, b, rule.bFilter);
  }
  return clashRule;
}

/**
 * Start a clash run across one or more models. Returns a jobId immediately —
 * poll ifc_clash_result.
 *
 * Clash tessellates every model before pairing anything, and that cost is
 * large and unpredictable (the same 2.1MB model measured 299s and 4921s on
 * separate runs), so this cannot be a blocking call. Models already warm from
 * a previous run are far cheaper.
 *
 * Note on selectors: an unfiltered run over structural models is dominated by
 * rebar-inside-concrete, which is correct by design rather than a defect.
 * Narrow rule selectors to the disciplines you actually care about.
 */
export async function ifcClashStart(client: DaluxClient, args: IfcClashStartInput) {
  if (!args.ruleIds?.length && !args.rule) {
    throw new Error('Provide ruleIds (catalog rules), a `rule` (ad-hoc), or both.');
  }

  const resolved = await Promise.all(
    args.models.map((m) => resolveModel(client, { projectId: args.projectId, fileAreaId: m.fileAreaId, fileId: m.fileId })),
  );

  const rules: ClashRule[] = [];
  if (args.ruleIds?.length) {
    const catalogRules = await getRules(args.ruleIds);
    for (const r of catalogRules) {
      rules.push({
        id: r.id,
        name: r.name,
        a: r.a,
        ...(r.b != null ? { b: r.b } : {}),
        mode: r.mode,
        ...(r.tolerance != null ? { tolerance: r.tolerance } : {}),
        ...(r.clearance != null ? { clearance: r.clearance } : {}),
        ...(r.severity != null ? { severity: r.severity } : {}),
        ...(r.reportTouch ? { reportTouch: true } : {}),
      });
    }
  }
  if (args.rule) rules.push(await buildAdHocRule(resolved, args.rule));

  const job = startClashJob({
    fileIds: args.models.map((m) => m.fileId),
    models: resolved.map((r) => r.model),
    rules,
  });

  const unfilteredAdHoc = args.rule && !args.rule.a && !args.rule.b;
  return {
    ...describeJob(job),
    hint: unfilteredAdHoc
      ? `Unfiltered ad-hoc rule. Embedded types such as ${COMMONLY_DOMINANT_TYPES.join(', ')} commonly dominate results; consider setting a/b.`
      : undefined,
  };
}

export const ifcClashResultInput = z.object({
  jobId: z.string().describe('The jobId returned by ifc_clash_start.'),
  topN: z.number().int().min(1).max(100).optional().describe('Clashes to inline, deepest first (default 20).'),
});
export type IfcClashResultInput = z.infer<typeof ifcClashResultInput>;

/** Poll a clash job. While running, returns status only. */
export async function ifcClashResult(_client: DaluxClient, args: IfcClashResultInput) {
  const job = getClashJob(args.jobId);
  if (!job) throw new Error(`Unknown clash jobId "${args.jobId}".`);
  const described = describeJob(job);
  if (job.status !== 'done' || !job.resultPath) return described;

  const raw = await import('node:fs/promises').then((fs) => fs.readFile(job.resultPath as string, 'utf-8'));
  const parsed = JSON.parse(raw) as { clashes?: unknown[] };
  const clashes = Array.isArray(parsed.clashes) ? parsed.clashes : [];
  return { ...described, topClashes: clashes.slice(0, args.topN ?? 20) };
}

// ---------- ifc_volumes_start / ifc_volumes_result ----------

export const ifcVolumesStartInput = z.object({
  ...ifcRef,
  type: z.string().optional().describe('Restrict to one IFC type, e.g. "IfcColumn". Omit for the whole model.'),
});
export type IfcVolumesStartInput = z.infer<typeof ifcVolumesStartInput>;

/**
 * Start geometric volume extraction on an IFC. Returns a jobId immediately —
 * poll ifc_volumes_result.
 *
 * Unlike ifc_schedule, this reads no property set: it meshes the model and
 * reads back the enclosed volume ifc-lite's geometry kernel proves for each
 * entity from the tessellated solid, in real-world cubic metres regardless of
 * the file's own length unit. That proof succeeds only for entities whose
 * geometry is a single closed, orientable, single-component solid (~71%
 * coverage on a measured corpus) — an open shell, a layered wall, or a
 * multi-item assembly mesh fine but yield no proved volume, which is reported
 * as absent, never as zero.
 *
 * Meshing is the same expensive, unpredictable step clash uses (minutes on a
 * cold model) and the two share one cache keyed by model, so a model already
 * meshed by a prior ifc_clash_start or ifc_volumes_start run on this process
 * resolves in seconds.
 */
export async function ifcVolumesStart(client: DaluxClient, args: IfcVolumesStartInput) {
  const { model } = await open(client, args);
  const job = startVolumeJob({ fileId: args.fileId, model, type: args.type });
  return describeVolumeJob(job);
}

export const ifcVolumesResultInput = z.object({
  jobId: z.string().describe('The jobId returned by ifc_volumes_start.'),
});
export type IfcVolumesResultInput = z.infer<typeof ifcVolumesResultInput>;

/** Poll a volume extraction job. While running, returns status only. */
export async function ifcVolumesResult(_client: DaluxClient, args: IfcVolumesResultInput) {
  const job = getVolumeJob(args.jobId);
  if (!job) throw new Error(`Unknown volumes jobId "${args.jobId}".`);
  return describeVolumeJob(job);
}

// ---------- ifc_diff ----------

const diffSide = z.object({
  fileAreaId: z.string(),
  fileId: z.string().describe('The file ID of an .ifc file.'),
});

export const ifcDiffInput = z.object({
  projectId: z.string().describe('The Dalux project ID both files belong to.'),
  base: diffSide.describe('The older/reference revision.'),
  head: diffSide
    .optional()
    .describe('The newer revision. Omit and pass editId instead to compare an open edit session against `base`.'),
  editId: z
    .string()
    .optional()
    .describe('Compare an open ifc_edit_start session (with its queued edits) against `base`, instead of a second Dalux file.'),
  byContent: z
    .boolean()
    .optional()
    .describe(
      'Also match entities by content, for revisions re-exported from scratch with new GlobalIds — without it a ' +
        're-GUID reads as the whole model deleted and re-added. Costs a full fingerprint pass. Default false.',
    ),
  propertyChanges: z
    .boolean()
    .optional()
    .describe('Also list which properties changed per element (same-GlobalId pairs only). Extracts property sets for every common entity, so it is the expensive option. Default false.'),
  type: z.string().optional().describe('Restrict propertyChanges to one IFC type, e.g. "IfcWall".'),
  maxElements: z.number().int().min(1).max(500).optional().describe('Cap on elements listed in propertyChanges (default 50). Totals are always reported whole.'),
});
export type IfcDiffInput = z.infer<typeof ifcDiffInput>;

/**
 * Compare two revisions of a model.
 *
 * Data scope only — see ../ifc/diffEngine.ts. An element that moved but kept
 * every attribute and property reads as unchanged here, because the geometry
 * fingerprint ifc-lite compares for that lives behind a WASM mesh pass this
 * path does not run. Say so when reporting a clean diff on a model somebody
 * expects to have moved.
 */
export async function ifcDiff(client: DaluxClient, args: IfcDiffInput) {
  if (!args.head && !args.editId) throw new Error('Provide `head` (a second Dalux file) or `editId` (an open edit session).');
  if (args.head && args.editId) throw new Error('Provide `head` or `editId`, not both — they are two different right-hand sides.');

  const baseResolved = await resolveModel(client, { projectId: args.projectId, fileAreaId: args.base.fileAreaId, fileId: args.base.fileId });

  let headModel: LoadedModel;
  let headLabel: string;
  if (args.editId) {
    const session = await getEditSession(client, args.editId);
    headModel = session.model;
    headLabel = `edit session ${session.id} on ${session.fileName} (${session.ops.length} pending operation(s))`;
  } else {
    const resolved = await resolveModel(client, { projectId: args.projectId, fileAreaId: args.head!.fileAreaId, fileId: args.head!.fileId });
    headModel = resolved.model;
    headLabel = resolved.fileName;
  }

  const diff = await runModelDiff(baseResolved.model, headModel, {
    byContent: args.byContent ?? false,
    byEntity: true,
  });

  const detail = args.propertyChanges
    ? propertyDeltas(baseResolved.model, headModel, { limit: args.maxElements ?? 50, type: args.type })
    : null;

  return {
    base: baseResolved.fileName,
    head: headLabel,
    scope: 'data',
    summary: diff.summary,
    typeDiffs: diff.typeDiffs,
    entityDiff: diff.entityDiff,
    ...(diff.contentDiff ? { contentDiff: diff.contentDiff } : {}),
    ...(detail
      ? {
          propertyChanges: {
            comparedElements: detail.comparedElements,
            changedElements: detail.changedElements,
            listed: detail.deltas.length,
            truncated: detail.changedElements > detail.deltas.length,
            elements: detail.deltas,
          },
        }
      : {}),
    note:
      'Data scope: attributes, property sets, quantity sets and IFC type. Geometry is not fingerprinted here, so an ' +
      'element that only moved or changed shape reads as unchanged.' +
      (args.byContent ? '' : ' Set byContent when the two revisions may have been re-exported with new GlobalIds.'),
  };
}

// ---------- ifc_edit_start / _apply / _review / _save ----------

export const ifcEditStartInput = z.object({ ...ifcRef });
export type IfcEditStartInput = z.infer<typeof ifcEditStartInput>;

/**
 * Open an in-memory edit session on a Dalux IFC.
 *
 * Nothing in Dalux is touched, now or later: the session holds a private
 * parse of the downloaded file, edits queue in memory, and ifc_edit_save
 * writes a NEW local .ifc. Uploading a revision back to Dalux is a manual
 * step the user does themselves.
 */
export async function ifcEditStart(client: DaluxClient, args: IfcEditStartInput) {
  const session = await openEditSession(client, args);
  const cat = buildCatalogue(session.model);

  return {
    editId: session.id,
    fileName: session.fileName,
    schema: session.model.store.schemaVersion,
    totalProducts: cat.totalProducts,
    productsWithProperties: cat.productsWithProperties,
    marking: {
      newPsetPrefix: AI_PSET_PREFIX,
      provenancePset: PROVENANCE_PSET,
      note:
        `Every property set this session creates is named "${AI_PSET_PREFIX}<name>", and every change — including ` +
        `an edit to an existing, unprefixed pset — is also recorded on the element in "${PROVENANCE_PSET}" with the ` +
        'old value, the new value and a timestamp. This is not optional and cannot be turned off.',
    },
    note:
      'Edits live only in this server\'s memory until ifc_edit_save writes a new local .ifc. The file in Dalux is ' +
      'never modified. The session is dropped after 2h idle or when the process restarts — queued edits are not persisted.',
  };
}

const editSelector = z
  .object({
    globalIds: z.array(z.string()).optional().describe('Explicit element GlobalIds. Use this or type/where, not both.'),
    type: z.string().optional().describe('IFC type, e.g. "IfcWall". Includes subtypes.'),
    where: z
      .object({
        pset: z.string().describe('Property set name (exact, as reported by ifc_discover_properties).'),
        property: z.string(),
        op: z.enum(['=', '!=', '>', '<', '>=', '<=', 'contains', 'exists', 'matches']),
        value: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Omit only for "exists".'),
      })
      .optional()
      .describe('Narrow a type selection by a property value.'),
  })
  .describe('Which elements this operation targets.');

const editOperation = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('set_property'),
    select: editSelector,
    pset: z.string().describe('Property set name. If the element does not already carry it, the set is created as "AI_<pset>".'),
    property: z.string(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    markValue: z
      .boolean()
      .optional()
      .describe('Also prefix the value itself with "AI: ". String values only — refused (and reported) on a number or boolean, where it would change the IFC value type and break quantity totals.'),
  }),
  z.object({
    kind: z.literal('delete_property'),
    select: editSelector,
    pset: z.string().describe('Exact existing pset name (not AI_-prefixed unless the set really is).'),
    property: z.string(),
  }),
  z.object({
    kind: z.literal('delete_pset'),
    select: editSelector,
    pset: z.string().describe('Exact existing property set name to remove in full.'),
  }),
  z.object({
    kind: z.literal('set_attribute'),
    select: editSelector,
    attribute: z.enum(['Name', 'Description', 'ObjectType', 'Tag']),
    value: z.string(),
  }),
  z.object({
    kind: z.literal('undo'),
    count: z.number().int().min(1).optional().describe('How many previous operations to revert (default 1). Counted in operations, not in underlying mutations.'),
  }),
]);

export const ifcEditApplyInput = z.object({
  editId: z.string().describe('The editId from ifc_edit_start.'),
  operations: z.array(editOperation).min(1).describe('Operations, applied in order. Not atomic: a failure is reported in results[] and does not roll back the ones before it.'),
  maxElements: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .optional()
    .describe(`Cap on elements one operation may touch (default ${DEFAULT_MAX_ELEMENTS}). A selector matching more is refused with its count rather than applied.`),
});
export type IfcEditApplyInput = z.infer<typeof ifcEditApplyInput>;

/**
 * Queue edits onto an open session.
 *
 * Deliberately not atomic, and says so on the tool: operations run in order
 * and each records its own outcome. Rolling back a partially-applied batch
 * would mean undoing operations the caller may have wanted kept, so the
 * choice is left to them — `{ kind: 'undo' }` is an operation.
 */
export async function ifcEditApply(client: DaluxClient, args: IfcEditApplyInput) {
  const session = await getEditSession(client, args.editId);
  const max = args.maxElements ?? DEFAULT_MAX_ELEMENTS;

  const results: OperationResult[] = [];
  for (const operation of args.operations) {
    try {
      results.push(await applyOperation(session, operation as EditOperation, max));
    } catch (err) {
      results.push({
        kind: operation.kind,
        ok: false,
        summary: `${operation.kind} failed.`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  return {
    editId: session.id,
    applied: results.length - failed,
    failed,
    results,
    pendingOperations: session.ops.length,
    note: failed > 0 ? 'Operations before a failure stayed queued — nothing was rolled back.' : undefined,
  };
}

export const ifcEditReviewInput = z.object({
  editId: z.string().describe('The editId from ifc_edit_start.'),
  maxMutations: z.number().int().min(1).max(500).optional().describe('Cap on raw mutation entries listed (default 50). Counts are always whole.'),
});
export type IfcEditReviewInput = z.infer<typeof ifcEditReviewInput>;

/** What is queued on a session, in caller operations and in ifc-lite mutations. */
export async function ifcEditReview(client: DaluxClient, args: IfcEditReviewInput) {
  const session = await getEditSession(client, args.editId);
  const mutations = pendingMutations(session);
  const limit = args.maxMutations ?? 50;

  return {
    editId: session.id,
    fileName: session.fileName,
    operations: session.ops,
    pendingMutations: mutations.length,
    mutations: mutations.slice(0, limit),
    truncated: mutations.length > limit,
    lastSave: session.lastSave,
    note:
      `One operation produces several mutations — the change plus its ${PROVENANCE_PSET} rows. Undo counts in ` +
      'operations (ifc_edit_apply with kind "undo"), not in mutations.',
  };
}

export const ifcEditSaveInput = z.object({
  editId: z.string().describe('The editId from ifc_edit_start.'),
  fileName: z.string().optional().describe('Base name for the written file. Defaults to the source name; "-AI-edited-<timestamp>.ifc" is always appended.'),
  confirmed: z
    .boolean()
    .optional()
    .describe(
      'Leave unset to preview exactly what would be written without writing it. Only set true after showing the ' +
        'user the operation list from the preview and getting their explicit agreement to write that set of changes.',
    ),
  discard: z.boolean().optional().describe('Drop the session and everything queued on it instead of saving. Requires confirmed: true.'),
});
export type IfcEditSaveInput = z.infer<typeof ifcEditSaveInput>;

/**
 * Write the edited model to a new local .ifc, or discard the session.
 *
 * Confirmation-gated in the same shape as report_feedback: an unconfirmed
 * call only describes what would happen. Writing a model whose provenance
 * says "AI" is a thing somebody will hand to a contractor, so the user should
 * have seen the change list before it exists as a file.
 *
 * The result is a local file plus a download link. It is NOT uploaded to
 * Dalux — this server does not write to Dalux project data.
 */
export async function ifcEditSave(client: DaluxClient, args: IfcEditSaveInput) {
  const session = await getEditSession(client, args.editId);

  if (args.discard) {
    if (!args.confirmed) {
      return {
        discarded: false,
        editId: session.id,
        operations: session.ops,
        message: `Not discarded. This would drop ${session.ops.length} queued operation(s), unrecoverably. Confirm with the user, then call again with confirmed: true.`,
      };
    }
    discardEditSession(session.id);
    return { discarded: true, editId: session.id, droppedOperations: session.ops.length };
  }

  if (session.ops.length === 0) {
    return { saved: false, editId: session.id, message: 'Nothing queued on this session — no file written.' };
  }

  if (!args.confirmed) {
    return {
      saved: false,
      editId: session.id,
      preview: {
        sourceFile: session.fileName,
        operations: session.ops,
        pendingMutations: pendingMutations(session).length,
        marking: { newPsetPrefix: AI_PSET_PREFIX, provenancePset: PROVENANCE_PSET },
      },
      message:
        'Not written yet. Show the user this operation list and confirm it is what they want written, then call ' +
        'again with confirmed: true. The output is a new local file — the model in Dalux is not modified either way.',
    };
  }

  const saved = await saveEditSession(session, args.fileName);
  const downloadUrl = await createDownloadLink(saved.filePath, path.basename(saved.filePath));

  return {
    saved: true,
    editId: session.id,
    fileName: path.basename(saved.filePath),
    schema: saved.schema,
    bytes: saved.bytes,
    localPath: saved.filePath,
    downloadUrl,
    operations: session.ops,
    note:
      'Written locally only — nothing was uploaded to Dalux. The link is single-use, valid ~15 minutes, and only ' +
      `reachable from the machine this server runs on. Edits are marked: new psets are "${AI_PSET_PREFIX}…" and ` +
      `every change is recorded in "${PROVENANCE_PSET}" on the element. The session stays open, so you can keep editing and save again.`,
  };
}
