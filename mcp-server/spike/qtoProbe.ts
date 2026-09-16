/**
 * Phase 0b: does Dalux-exported IFC actually carry Qto_ quantity sets?
 * geometry_volume/geometry_area read ONLY IfcElementQuantity, so this decides
 * whether ifc_quantities can work at all or needs a mesh-derived fallback.
 */
const IFC_PATH = process.argv[2];

async function main() {
  const ifc = await import('@ifc-lite/mcp');
  const t0 = Date.now();
  const model = await ifc.loadIfcModel(IFC_PATH);
  console.log(`loaded ${model.name} in ${Date.now() - t0}ms`);

  const registry = new ifc.InMemoryModelRegistry();
  registry.add(model);
  const tools = ifc.buildDefaultToolRegistry();
  const ctx: any = {
    registry,
    scope: ifc.FULL_ACCESS,
    progress: ifc.NOOP_PROGRESS,
    log: ifc.SILENT_LOGGER,
    signal: new AbortController().signal,
    config: { ...ifc.DEFAULT_CONFIG, readOnly: true },
  };

  const info: any = await tools.get('model_info')!.handler({}, ctx);
  console.log(info.content[0].text);

  // What element types exist, and how many carry quantity sets?
  const { EntityNode } = await import('@ifc-lite/parser');
  const all = model.bim.query().toArray();
  console.log(`total products: ${all.length}`);

  const byType: Record<string, { n: number; withQto: number; qnames: Set<string> }> = {};
  for (const e of all) {
    const t = (e as any).type ?? 'unknown';
    byType[t] ??= { n: 0, withQto: 0, qnames: new Set() };
    byType[t].n++;
    try {
      const node = new (EntityNode as any)(model.store, (e as any).ref);
      const qsets = node.quantities();
      if (qsets.length > 0) {
        byType[t].withQto++;
        for (const qs of qsets) for (const q of qs.quantities) byType[t].qnames.add(`${qs.name}.${q.name}`);
      }
    } catch { /* ignore */ }
  }

  const rows = Object.entries(byType).sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  console.log('\ntype                        count  withQto  sample quantity paths');
  for (const [t, v] of rows) {
    console.log(
      `${t.padEnd(26)} ${String(v.n).padStart(5)}  ${String(v.withQto).padStart(7)}  ${[...v.qnames].slice(0, 3).join(', ')}`,
    );
  }

  const totalWithQto = Object.values(byType).reduce((s, v) => s + v.withQto, 0);
  console.log(`\nVERDICT: ${totalWithQto}/${all.length} products carry IfcElementQuantity`);

  // Property sets are the other table source — are those present?
  const psetSample = model.bim.query().toArray().slice(0, 400);
  const psetNames = new Set<string>();
  for (const e of psetSample) {
    try {
      for (const ps of model.bim.properties((e as any).ref) ?? []) psetNames.add((ps as any).name);
    } catch { /* ignore */ }
  }
  console.log(`psets found (first 400 products): ${[...psetNames].slice(0, 12).join(', ')}`);

  const tc = Date.now();
  const clash: any = await tools.get('clash_check')!.handler({ mode: 'hard' }, ctx);
  console.log(`\nclash_check on ${all.length} products: ${Date.now() - tc}ms`);
  console.log(clash.content[0].text);
  console.log('byTypePair:', JSON.stringify(clash.structuredContent?.summary?.byTypePair ?? {}, null, 1).slice(0, 600));
}

main().catch((e) => { console.error('[FAIL]', e); process.exit(1); });
