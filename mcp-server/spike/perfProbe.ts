/**
 * Phase 0c: two blockers found on the 2.1MB model.
 *  1. clash_check took 299s (whole-model CSG meshing, not the pairing).
 *  2. ifc-lite writes CSG diagnostics to STDOUT — fatal on an MCP stdio transport.
 * Measure the mesh-cache hit, and prove whether stdout can be captured/silenced.
 */
const IFC_PATH = process.argv[2];

async function main() {
  const ifc = await import('@ifc-lite/mcp');
  const model = await ifc.loadIfcModel(IFC_PATH);
  const registry = new ifc.InMemoryModelRegistry();
  registry.add(model);
  const tools = ifc.buildDefaultToolRegistry();
  const ctx: any = {
    registry, scope: ifc.FULL_ACCESS, progress: ifc.NOOP_PROGRESS,
    log: ifc.SILENT_LOGGER, signal: new AbortController().signal,
    config: { ...ifc.DEFAULT_CONFIG, readOnly: true },
  };

  // --- Does ifc-lite pollute stdout? Intercept process.stdout.write directly. ---
  let stdoutBytes = 0;
  let stdoutSample = '';
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: any, ...rest: any[]) => {
    const s = typeof chunk === 'string' ? chunk : String(chunk);
    if (s.includes('IFC-LITE') || s.includes('CSG')) {
      stdoutBytes += s.length;
      if (!stdoutSample) stdoutSample = s.slice(0, 120);
      return true; // swallow it
    }
    return realWrite(chunk, ...rest);
  };

  const t1 = Date.now();
  const r1: any = await tools.get('clash_check')!.handler({ mode: 'hard' }, ctx);
  const cold = Date.now() - t1;

  const t2 = Date.now();
  const r2: any = await tools.get('clash_check')!.handler({ a: 'IfcSlab', b: 'IfcSlab', mode: 'hard' }, ctx);
  const warm = Date.now() - t2;

  (process.stdout as any).write = realWrite;

  console.log(`\n=== RESULTS ===`);
  console.log(`cold clash_check (full mesh): ${(cold / 1000).toFixed(1)}s -> ${r1.structuredContent?.summary?.total} clashes`);
  console.log(`warm clash_check (mesh cached, IfcSlab vs IfcSlab): ${(warm / 1000).toFixed(1)}s -> ${r2.structuredContent?.summary?.total} clashes`);
  console.log(`\nSTDOUT POLLUTION: ${stdoutBytes} bytes of ifc-lite diagnostics written to process.stdout`);
  if (stdoutSample) console.log(`  sample: ${JSON.stringify(stdoutSample)}`);
  console.log(`  -> on an MCP stdio transport this corrupts the JSON-RPC framing.`);
  console.log(`\nheap used: ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB, rss: ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
}
main().catch((e) => { console.error('[FAIL]', e); process.exit(1); });
