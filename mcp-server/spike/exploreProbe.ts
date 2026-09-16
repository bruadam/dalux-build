/**
 * Phase 0e: pset / property exploration + filtering via ifc-lite MCP tools.
 *
 * Two questions:
 *  1. Do the stock tools (count_entities, properties_unique, query_entities,
 *     get_entity, materials_list, schema_describe) work on Dalux IFCs?
 *  2. There is NO tool that enumerates which psets/properties a model HAS.
 *     properties_unique already requires type+pset+property. So prototype the
 *     discovery pass that ifc_discover_properties would need.
 */
const IFC_PATH = process.argv[2];
const FOCUS_TYPE = process.argv[3] ?? 'IfcColumn';

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

  const call = async (name: string, input: any = {}, label?: string) => {
    const tool = tools.get(name);
    if (!tool) return console.log(`  [missing tool ${name}]`);
    try {
      const r: any = await tool.handler(input, ctx);
      const txt = (r.content ?? []).map((c: any) => c.text ?? '').join('\n');
      console.log(`\n--- ${label ?? name} ${r.isError ? '(isError)' : ''}`);
      console.log(txt.split('\n').slice(0, 14).join('\n'));
      return r;
    } catch (e: any) {
      console.log(`\n--- ${label ?? name}  THREW ${e?.constructor?.name}: ${e.message}`);
      return null;
    }
  };

  console.log(`### MODEL: ${model.name}`);

  console.log('\n================ 1. COUNTING / GROUPING ================');
  await call('count_entities', {});
  await call('count_entities', { group_by: 'type' });
  await call('count_entities', { group_by: 'storey' });
  await call('count_entities', { group_by: 'material' });

  console.log('\n================ 2. PSET DISCOVERY (no stock tool) ================');
  // type -> pset -> prop -> {count, sample}
  const cat = new Map<string, Map<string, Map<string, { n: number; sample: any }>>>();
  const typeTotals = new Map<string, number>();
  for (const e of model.bim.query().toArray() as any[]) {
    const t = e.type ?? 'unknown';
    typeTotals.set(t, (typeTotals.get(t) ?? 0) + 1);
    let byPset = cat.get(t);
    if (!byPset) cat.set(t, (byPset = new Map()));
    let psets: any[] = [];
    try { psets = (model.bim.properties(e.ref) ?? []) as any[]; } catch { continue; }
    for (const ps of psets) {
      let byProp = byPset.get(ps.name);
      if (!byProp) byPset.set(ps.name, (byProp = new Map()));
      for (const p of ps.properties ?? []) {
        const cur = byProp.get(p.name);
        if (cur) cur.n++;
        else byProp.set(p.name, { n: 1, sample: p.value });
      }
    }
  }
  for (const [t, byPset] of [...cat.entries()].sort((a, b) => (typeTotals.get(b[0])! - typeTotals.get(a[0])!)).slice(0, 4)) {
    console.log(`\n${t}  (${typeTotals.get(t)} elements, ${byPset.size} psets)`);
    for (const [psName, byProp] of byPset) {
      const props = [...byProp.entries()].slice(0, 6)
        .map(([n, v]) => `${n}=${JSON.stringify(v.sample)}(${v.n})`).join('  ');
      console.log(`   [${psName}] ${props}${byProp.size > 6 ? `  …+${byProp.size - 6}` : ''}`);
    }
  }

  // Pick a real pset/prop from the catalogue to drive the filter tests.
  const focusPsets = cat.get(FOCUS_TYPE);
  let probePset = process.argv[4] ?? '', probeProp = process.argv[5] ?? '', probeVal: any;
  if (probePset && probeProp) {
    probeVal = focusPsets?.get(probePset)?.get(probeProp)?.sample;
  } else if (focusPsets) {
    outer: for (const [psName, byProp] of focusPsets) {
      for (const [pName, v] of byProp) {
        if (typeof v.sample === 'number' || typeof v.sample === 'string') {
          probePset = psName; probeProp = pName; probeVal = v.sample; break outer;
        }
      }
    }
  }
  console.log(`\n>>> filter probe target: ${FOCUS_TYPE} / ${probePset}.${probeProp} (sample=${JSON.stringify(probeVal)})`);

  console.log('\n================ 3. properties_unique ================');
  await call('properties_unique', { type: FOCUS_TYPE, pset: probePset, property: probeProp });
  await call('properties_unique', { type: FOCUS_TYPE, pset: 'NoSuchPset', property: 'Nope' }, 'properties_unique (bogus pset)');

  console.log('\n================ 4. query_entities FILTERING ================');
  await call('query_entities', { type: FOCUS_TYPE, limit: 3 }, 'by type');
  for (const op of ['=', '!=', '>', '<', '>=', '<=', 'contains', 'exists', 'matches']) {
    const input: any = { type: FOCUS_TYPE, property: { pset: probePset, name: probeProp, op }, limit: 2 };
    if (op !== 'exists') input.property.value = op === 'contains' || op === 'matches' ? String(probeVal).slice(0, 3) : probeVal;
    await call('query_entities', input, `property op "${op}"`);
  }

  console.log('\n================ 5. SELECTOR SYNTAX ================');
  await call('query_entities', { selector: FOCUS_TYPE, limit: 2 }, 'selector: bare class');
  await call('query_entities', { selector: `${FOCUS_TYPE}, ${probePset}.${probeProp}=${probeVal}`, limit: 2 }, 'selector: class + pset compare');
  await call('query_entities', { selector: `!${FOCUS_TYPE}`, limit: 2 }, 'selector: UNSUPPORTED class negation');
  await call('query_entities', { selector: `material=steel`, limit: 2 }, 'selector: UNSUPPORTED material=');

  console.log('\n================ 6. ENTITY DETAIL / MISC ================');
  const first: any = (model.bim.query().byType(FOCUS_TYPE).toArray() as any[])[0];
  if (first) await call('get_entity', { global_id: first.globalId ?? first.GlobalId, include: ['attributes', 'properties', 'quantities', 'materials'] }, 'get_entity');
  await call('materials_list', {});
  await call('classifications_list', {});
  await call('units', {});
  await call('spatial_hierarchy', {});
}
main().catch((e) => { console.error('[FAIL]', e); process.exit(1); });
