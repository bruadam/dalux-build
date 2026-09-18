/**
 * IFC analysis tools over models pulled from Dalux.
 *
 * Every tool is keyed by Dalux identifiers (projectId / fileAreaId / fileId) —
 * callers never see or supply a local cache path. The model is downloaded and
 * parsed on first use and kept resident (see ../ifc/session.ts).
 *
 * This surface is deliberately narrow. ifc-lite ships 85 tools including
 * entity_delete, entity_create and model_save, and because we invoke handlers
 * directly its scope gating never runs — so what is re-exported here is the
 * only boundary. Keep it read-only.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import type { ClashRule } from '@ifc-lite/clash';
import type { ComparisonOp } from '@ifc-lite/sdk';

import { derivedDirFor } from '../cachePaths';
import { buildCatalogue, splitPath, validateColumns } from '../ifc/catalogue';
import { resolveMembers } from '../ifc/clashEngine';
import { describeJob, getClashJob, startClashJob, COMMONLY_DOMINANT_TYPES } from '../ifc/clashJobs';
import { buildToolContext, callIfcTool } from '../ifc/runtime';
import { deleteRule, getRules, listRules, saveRule } from '../ifc/ruleCatalog';
import { resolveModel, type ResolvedModel } from '../ifc/session';
import { describeVolumeJob, getVolumeJob, startVolumeJob } from '../ifc/volumeJobs';

const ifcRef = {
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
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
  return { matched: res.data.total ?? res.data.count, entities: res.data.entities ?? res.text };
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
  projectId: z.string().describe('The Dalux project ID.'),
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
