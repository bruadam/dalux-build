/**
 * Manual smoke run for the ifc_edit_* / ifc_diff path against a real cached
 * Dalux model. Not part of the jest suite — it needs a multi-MB IFC on disk.
 *
 *   IFC_FILE=/tmp/dalux-mcp/files/<id>/model.ifc npx tsx spike/editSmoke.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

import { buildCatalogue } from '../src/ifc/catalogue';
import { applyOperation } from '../src/ifc/editEngine';
import { openEditSession, pendingMutations, saveEditSession } from '../src/ifc/editSession';
import { propertyDeltas, runModelDiff } from '../src/ifc/diffEngine';
import { resolveModel } from '../src/ifc/session';

const IFC_FILE = process.env.IFC_FILE;
if (!IFC_FILE) throw new Error('Set IFC_FILE to a cached .ifc path.');

// fileId is the cache directory name — session.ts finds the file from it.
const FILE_ID = path.basename(path.dirname(IFC_FILE));
const REF = { projectId: 'p', fileAreaId: 'fa', fileId: FILE_ID };

// assertReadable only needs a truthy non-string answer.
const client = { files: { getFile: async () => ({ fileId: FILE_ID }) } } as unknown as DaluxClient;

async function main() {
  console.error(`[smoke] model ${path.basename(IFC_FILE!)}`);

  const session = await openEditSession(client, REF);
  const cat = buildCatalogue(session.model);
  const biggest = cat.types.find((t) => t.psets.length > 0) ?? cat.types[0];
  console.error(`[smoke] editId=${session.id} biggest type=${biggest.type} (${biggest.elementCount})`);

  const sample = session.model.bim.query().byType(biggest.type).toArray().slice(0, 3);
  const globalIds = sample.map((e) => e.globalId);
  console.error(`[smoke] targets: ${globalIds.join(', ')}`);

  const existingPset = biggest.psets[0];
  console.error(`[smoke] existing pset on this type: ${existingPset?.name} (${existingPset?.properties[0]?.name})`);

  // 1. a brand-new pset -> must come out AI_-prefixed
  const created = await applyOperation(
    session,
    { kind: 'set_property', select: { globalIds }, pset: 'Review', property: 'Status', value: 'Checked' },
    500,
  );
  console.error('[smoke] create ->', JSON.stringify(created));

  // 2. an edit to a pset the element already has -> must stay in place
  if (existingPset?.properties[0]) {
    const inPlace = await applyOperation(
      session,
      {
        kind: 'set_property',
        select: { globalIds },
        pset: existingPset.name,
        property: existingPset.properties[0].name,
        value: 'OVERWRITTEN-BY-AI',
      },
      500,
    );
    console.error('[smoke] in-place ->', JSON.stringify(inPlace));
  }

  // 3. numeric value + markValue -> must refuse the prefix, keep the number
  const numeric = await applyOperation(
    session,
    { kind: 'set_property', select: { globalIds }, pset: 'Review', property: 'Score', value: 0.18, markValue: true },
    500,
  );
  console.error('[smoke] numeric+markValue ->', JSON.stringify(numeric));

  // 4. delete a whole pset off one element
  if (existingPset) {
    const deleted = await applyOperation(
      session,
      { kind: 'delete_pset', select: { globalIds: [globalIds[0]] }, pset: existingPset.name },
      500,
    );
    console.error('[smoke] delete_pset ->', JSON.stringify(deleted));
  }

  console.error(`[smoke] ops=${session.ops.length} mutations=${pendingMutations(session).length}`);

  // 5a. undo across the delete_pset must be refused, having changed nothing
  const before = { ops: session.ops.length, mutations: pendingMutations(session).length };
  try {
    await applyOperation(session, { kind: 'undo', count: 1 }, 500);
    console.error('[smoke] undo across delete_pset: NOT refused (unexpected)');
  } catch (err) {
    console.error('[smoke] undo across delete_pset refused:', (err as Error).message.slice(0, 160));
  }
  const after = { ops: session.ops.length, mutations: pendingMutations(session).length };
  console.error(`[smoke] unchanged by the refusal: ${JSON.stringify(before) === JSON.stringify(after)} ${JSON.stringify(after)}`);

  // 5b. a plain property edit undoes fine
  await applyOperation(session, { kind: 'set_property', select: { globalIds }, pset: 'AI_Review', property: 'Temp', value: 'x' }, 500);
  const undone = await applyOperation(session, { kind: 'undo', count: 1 }, 500);
  console.error('[smoke] undo ->', JSON.stringify(undone));
  console.error(`[smoke] after undo: ops=${session.ops.length} mutations=${pendingMutations(session).length}`);

  // 6. diff the session against the original file
  const original = await resolveModel(client, REF);
  const diff = await runModelDiff(original.model, session.model, { byContent: false, byEntity: true });
  console.error('[smoke] diff summary:', diff.summary);
  const deltas = propertyDeltas(original.model, session.model, { limit: 3 });
  console.error(`[smoke] property deltas: changed=${deltas.changedElements} compared=${deltas.comparedElements}`);
  console.error(JSON.stringify(deltas.deltas, null, 2).slice(0, 2000));

  // 7. save and re-read the bytes
  const saved = await saveEditSession(session, 'smoke');
  console.error(`[smoke] wrote ${saved.bytes} bytes -> ${saved.filePath}`);
  const text = readFileSync(saved.filePath, 'utf-8');
  for (const needle of ['AI_Review', 'AI_Provenance', 'OVERWRITTEN-BY-AI']) {
    console.error(`[smoke] file contains ${needle}: ${text.includes(needle)}`);
  }
  const aiScore = text.includes("'AI: 0.18'");
  console.error(`[smoke] value prefix leaked onto the number: ${aiScore} (must be false)`);
}

main().catch((err) => {
  console.error('[smoke] FAILED', err);
  process.exit(1);
});
