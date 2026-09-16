/**
 * Phase 0d: clash_check hardcodes `new GeometryProcessor()`, and that cost 299s
 * on the 2.1MB model. Benchmark the lower-level path with skipSmallCuts +
 * reduced tessellation to see whether a self-built clash tool can be interactive.
 */
import { readFile } from 'node:fs/promises';

const IFC_PATH = process.argv[2];

async function bench(label: string, opts: any, bytes: Uint8Array, store: any, modelId: string) {
  const { GeometryProcessor } = await import('@ifc-lite/geometry');
  const { createClashEngine } = await import('@ifc-lite/clash');
  const { elementsFromStep } = await import('@ifc-lite/clash/step' as any);

  const t0 = Date.now();
  const gp = new (GeometryProcessor as any)(opts);
  await gp.init();
  const result = await gp.process(bytes);
  const meshMs = Date.now() - t0;
  const meshes = result.meshes;
  gp.dispose();

  const t1 = Date.now();
  const { elements, exclusions } = (elementsFromStep as any)({ store, meshes, modelId });
  const engine = (createClashEngine as any)({ backend: 'ts' });
  const rule = { id: 'bench', name: 'all', a: '*', mode: 'hard' };
  const res = await engine.run(elements, [rule], { exclusions });
  const clashMs = Date.now() - t1;

  console.log(
    `${label.padEnd(38)} mesh=${(meshMs / 1000).toFixed(1)}s  clash=${(clashMs / 1000).toFixed(1)}s  ` +
    `total=${((meshMs + clashMs) / 1000).toFixed(1)}s  meshes=${meshes.length}  clashes=${res.clashes.length}`,
  );
}

async function main() {
  const ifc = await import('@ifc-lite/mcp');
  const model = await ifc.loadIfcModel(IFC_PATH);
  const bytes = new Uint8Array(await readFile(IFC_PATH));
  console.log(`model: ${model.name}  (${(bytes.byteLength / 1e6).toFixed(1)} MB)\n`);

  // Silence ifc-lite's stdout diagnostics so the table stays readable.
  const realWrite = process.stdout.write.bind(process.stdout);
  let swallowed = 0;
  (process.stdout as any).write = (c: any, ...r: any[]) => {
    const s = typeof c === 'string' ? c : String(c);
    if (s.includes('IFC-LITE') || s.includes('CSG') || s.includes('Opening classifier')) { swallowed += s.length; return true; }
    return realWrite(c, ...r);
  };

  // Baseline (plain `new GeometryProcessor()`) is deliberately NOT re-run here:
  // measured at 299s and 4921s on this same model, so it is both unusable and
  // wildly non-deterministic. Compare these against that.
  await bench('skipSmallCuts', { skipSmallCuts: true }, bytes, model.store, model.id);
  await bench('skipSmallCuts + tess=low', { skipSmallCuts: true, tessellationQuality: 'low' }, bytes, model.store, model.id);

  (process.stdout as any).write = realWrite;
  console.log(`\n(${swallowed} bytes of ifc-lite stdout diagnostics swallowed)`);
}
main().catch((e) => { console.error('[FAIL]', e); process.exit(1); });
