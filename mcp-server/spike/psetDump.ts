const IFC_PATH = process.argv[2];
const TYPE = process.argv[3] ?? 'IfcColumn';

async function main() {
  const ifc = await import('@ifc-lite/mcp');
  const model = await ifc.loadIfcModel(IFC_PATH);
  const el = model.bim.query().byType(TYPE).toArray()[0] as any;
  if (!el) return console.log(`no ${TYPE} found`);
  console.log(`--- ${TYPE} ref=${el.ref} name=${el.name ?? '?'} ---`);
  for (const ps of (model.bim.properties(el.ref) ?? []) as any[]) {
    console.log(`\n[${ps.name}]`);
    for (const p of ps.properties ?? []) console.log(`   ${p.name} = ${JSON.stringify(p.value)} ${p.unit ?? ''}`);
  }

  // Can export_csv reach those quantity props by path?
  const registry = new ifc.InMemoryModelRegistry();
  registry.add(model);
  const tools = ifc.buildDefaultToolRegistry();
  const ctx: any = {
    registry, scope: ifc.FULL_ACCESS, progress: ifc.NOOP_PROGRESS,
    log: ifc.SILENT_LOGGER, signal: new AbortController().signal,
    config: { ...ifc.DEFAULT_CONFIG, readOnly: true },
  };
  const cols = process.argv.slice(4);
  if (cols.length) {
    const res: any = await tools.get('export_csv')!.handler({ type: TYPE, columns: cols }, ctx);
    console.log(`\n=== export_csv columns=${cols.join('|')} ===`);
    console.log((res.structuredContent?.csv ?? '').split('\n').slice(0, 6).join('\n'));
  }
}
main().catch((e) => { console.error('[FAIL]', e); process.exit(1); });
