/**
 * Phase 0 spike: prove @ifc-lite/mcp (ESM-only) is callable from the CJS bundle
 * tsup produces, and that clash_check runs headless on a Dalux-downloaded IFC.
 */

const IFC_PATH = process.argv[2];
if (!IFC_PATH) {
  console.error('usage: clashSpike <path-to.ifc>');
  process.exit(2);
}

async function main() {
  const t0 = Date.now();

  const ifc = await import('@ifc-lite/mcp');
  console.log(`[ok] dynamic import resolved in ${Date.now() - t0}ms`);
  console.log(`[ok] exports present:`, {
    buildDefaultToolRegistry: typeof ifc.buildDefaultToolRegistry,
    loadIfcModel: typeof ifc.loadIfcModel,
    InMemoryModelRegistry: typeof ifc.InMemoryModelRegistry,
    READ_ONLY: typeof ifc.READ_ONLY,
  });

  const t1 = Date.now();
  const model = await ifc.loadIfcModel(IFC_PATH);
  console.log(`[ok] loadIfcModel in ${Date.now() - t1}ms -> id=${model.id} name=${model.name}`);

  const registry = new ifc.InMemoryModelRegistry();
  registry.add(model);

  const tools = ifc.buildDefaultToolRegistry();
  console.log(`[ok] tool registry: ${tools.list().length} tools`);

  const ctx: any = {
    registry,
    scope: ifc.READ_ONLY,
    progress: ifc.NOOP_PROGRESS,
    log: ifc.SILENT_LOGGER,
    signal: new AbortController().signal,
    config: { ...ifc.DEFAULT_CONFIG, readOnly: true },
  };

  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`tool not found: ${name}`);
    const t = Date.now();
    let res: any;
    try {
      res = await tool.handler(input, ctx);
    } catch (err: any) {
      console.log(`\n=== ${name} (${Date.now() - t}ms) THREW: ${err?.constructor?.name}: ${err.message}`);
      return { threw: err };
    }
    const text = (res.content ?? [])
      .map((c: any) => (c.type === 'text' ? c.text : `<${c.type}>`))
      .join('\n');
    console.log(`\n=== ${name} (${Date.now() - t}ms, isError=${!!res.isError}) ===`);
    console.log(text.slice(0, 1800));
    return res;
  };

  await call('model_info');

  const clash = await call('clash_check', { mode: 'hard' });
  console.log('\n=== clash_check RAW SHAPE ===');
  console.log('top-level keys:', Object.keys(clash));
  console.log('content blocks:', (clash.content ?? []).map((c: any) => c.type));
  if (clash.structuredContent) {
    console.log('structuredContent keys:', Object.keys(clash.structuredContent));
    console.log(JSON.stringify(clash.structuredContent, null, 2).slice(0, 2500));
  }

  console.log('\n=== ALL TOOL NAMES ===');
  console.log(tools.list().map((t: any) => t.name).sort().join(' '));

  // Phase 2 path: query + quantities + table export
  await call('query_entities', { type: 'IfcColumn', limit: 2 });
  await call('properties_unique', { type: 'IfcColumn' });
  await call('geometry_volume', { type: 'IfcColumn' });
  await call('geometry_area', { type: 'IfcColumn' });
  await call('export_csv', { type: 'IfcColumn' });

  console.log(`\n[done] total ${Date.now() - t0}ms`);
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
