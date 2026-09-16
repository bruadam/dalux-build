/**
 * End-to-end smoke test of the ifc_* tools against real Dalux models.
 *
 * Both fixtures are already in the download cache, so resolveModel() hits the
 * cache and the DaluxClient is never called — the stub below exists only to
 * satisfy the signature, and a network call would throw loudly rather than
 * silently pass.
 */
import type { DaluxClient } from 'dalux-build-api';
import * as ifc from '../src/tools/ifc';

const client = {
  files: {
    getFile() {
      throw new Error('DaluxClient was called — expected the model to come from cache.');
    },
  },
} as unknown as DaluxClient;

const TEKLA = { projectId: 'p', fileAreaId: 'a', fileId: 'S376341429678505988' };
const ITHESES = { projectId: 'p', fileAreaId: 'a', fileId: 'S386149753601130500' };

let failures = 0;

async function ok(label: string, fn: () => Promise<unknown>, show = (r: any) => JSON.stringify(r).slice(0, 320)) {
  try {
    const r = await fn();
    console.log(`\n✓ ${label}\n  ${show(r)}`);
    return r;
  } catch (e: any) {
    failures++;
    console.log(`\n✗ ${label}\n  THREW: ${e.message.slice(0, 300)}`);
    return null;
  }
}

async function expectReject(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    failures++;
    console.log(`\n✗ ${label}\n  expected a rejection, but it succeeded`);
  } catch (e: any) {
    console.log(`\n✓ ${label} (correctly rejected)\n  ${e.message.slice(0, 260)}`);
  }
}

async function main() {
  console.log('================ ifc_model_info ================');
  await ok('model_info (Tekla)', () => ifc.ifcModelInfo(client, TEKLA));
  await ok('model_info (i-Theses, sparse psets)', () => ifc.ifcModelInfo(client, ITHESES),
    (r) => JSON.stringify(r.propertyCoverage));

  console.log('\n================ ifc_discover_properties ================');
  await ok('discover IfcColumn', () => ifc.ifcDiscoverProperties(client, { ...TEKLA, type: 'IfcColumn' }),
    (r) => JSON.stringify(r.types?.[0]?.psets).slice(0, 420));

  console.log('\n================ ifc_property_values ================');
  await ok('histogram Tekla Quantity.Weight',
    () => ifc.ifcPropertyValues(client, { ...TEKLA, type: 'IfcColumn', property: 'Tekla Quantity.Weight' }));
  await expectReject('histogram on a bogus pset',
    () => ifc.ifcPropertyValues(client, { ...TEKLA, type: 'IfcColumn', property: 'NoSuchPset.Nope' }));

  console.log('\n================ ifc_query_elements ================');
  await ok('query Weight > 1200',
    () => ifc.ifcQueryElements(client, {
      ...TEKLA, type: 'IfcColumn', limit: 3,
      property: { path: 'Tekla Quantity.Weight', op: '>', value: 1200 },
    }), (r) => `matched=${r.matched}`);
  await ok('query Assembly Level = Single (name with a space)',
    () => ifc.ifcQueryElements(client, {
      ...TEKLA, type: 'IfcColumn', limit: 2,
      property: { path: 'ePset_Simplebim.Assembly Level', op: '=', value: 'Single' },
    }), (r) => `matched=${r.matched}`);
  await expectReject('query on an unknown property',
    () => ifc.ifcQueryElements(client, {
      ...TEKLA, type: 'IfcColumn',
      property: { path: 'Tekla Quantity.Nonexistent', op: '=', value: 1 },
    }));

  console.log('\n================ ifc_schedule (QTO) ================');
  await ok('schedule IfcColumn weights/volumes',
    () => ifc.ifcSchedule(client, {
      ...TEKLA, type: 'IfcColumn', previewRows: 3,
      columns: ['GlobalId', 'Name', 'Tekla Quantity.Weight', 'ColumnBaseQuantities.NetVolume', 'Pset_ColumnCommon.Reference'],
    }), (r) => `rows=${r.rows} csv=${r.csvPath}\n  ${r.preview.join('\n  ')}`);
  await expectReject('schedule with a hallucinated Qto_ column',
    () => ifc.ifcSchedule(client, {
      ...TEKLA, type: 'IfcColumn',
      columns: ['GlobalId', 'Qto_ColumnBaseQuantities.GrossVolume'],
    }));

  console.log('\n================ ifc_clash_start / ifc_clash_result ================');
  const started: any = await ok('clash_start (small model)',
    () => ifc.ifcClashStart(client, { ...TEKLA, mode: 'hard' }), (r) => `jobId=${r.jobId} status=${r.status}`);
  if (started?.jobId) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const res: any = await ifc.ifcClashResult(client, { jobId: started.jobId, topN: 2 });
      if (res.status !== 'running') {
        console.log(`\n✓ clash_result after ${i + 1}s: status=${res.status} clashes=${res.clashCount}`);
        console.log(`  byTypePair=${JSON.stringify(res.summary?.byTypePair)}`);
        console.log(`  resultPath=${res.resultPath}`);
        console.log(`  topClash=${JSON.stringify(res.topClashes?.[0]).slice(0, 220)}`);
        break;
      }
      if (i === 59) { failures++; console.log('\n✗ clash never finished within 60s'); }
    }
  }
  await expectReject('clash_result with an unknown jobId',
    () => ifc.ifcClashResult(client, { jobId: 'does-not-exist' }));

  console.log(`\n================ ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`} ================`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
