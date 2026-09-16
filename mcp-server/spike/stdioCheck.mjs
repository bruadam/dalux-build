/**
 * Speaks raw JSON-RPC to `dist/cli.js` over stdio, exactly as Claude Desktop
 * does. The point is framing integrity: ifc-lite logs geometry diagnostics to
 * stdout, and stdout is the transport, so anything non-JSON on that channel
 * breaks the session. Any unparseable stdout line fails this check.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const CLI = path.resolve(process.argv[2] ?? 'dist/cli.js');
const child = spawn('node', [CLI], { stdio: ['pipe', 'pipe', 'pipe'] });

let buffer = '';
const pending = new Map();
let nextId = 1;
const junk = [];

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const resolve = pending.get(msg.id);
      if (resolve) { pending.delete(msg.id); resolve(msg); }
    } catch {
      junk.push(line.slice(0, 160));
    }
  }
});

child.stderr.on('data', (d) => {
  const s = d.toString();
  if (process.env.VERBOSE) process.stderr.write(`[server stderr] ${s}`);
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 120000);
  });
}

const TEKLA = { projectId: 'S313578016888324096', fileAreaId: 'S313578021116182528', fileId: 'S376341429678505988' };

async function main() {
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'stdio-check', version: '0' },
  });
  console.log(`✓ initialize -> ${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const list = await send('tools/list', {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  const ifcTools = names.filter((n) => n.startsWith('ifc_'));
  console.log(`✓ tools/list -> ${names.length} tools, ${ifcTools.length} ifc_*`);
  console.log(`  ${ifcTools.join(', ')}`);

  // The heaviest stdout risk: anything that meshes or parses geometry.
  const info = await send('tools/call', { name: 'ifc_model_info', arguments: TEKLA });
  const infoText = info.result?.content?.[0]?.text ?? '';
  console.log(`✓ ifc_model_info -> ${infoText.slice(0, 150)}`);

  const disc = await send('tools/call', {
    name: 'ifc_discover_properties',
    arguments: { ...TEKLA, type: 'IfcColumn', maxTypes: 1 },
  });
  console.log(`✓ ifc_discover_properties -> ${(disc.result?.content?.[0]?.text ?? '').slice(0, 150)}`);

  const started = await send('tools/call', { name: 'ifc_clash_start', arguments: TEKLA });
  const job = JSON.parse(started.result?.content?.[0]?.text ?? '{}');
  console.log(`✓ ifc_clash_start -> jobId=${job.jobId} status=${job.status}`);

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await send('tools/call', { name: 'ifc_clash_result', arguments: { jobId: job.jobId, topN: 1 } });
    const res = JSON.parse(poll.result?.content?.[0]?.text ?? '{}');
    if (res.status !== 'running') {
      console.log(`✓ ifc_clash_result -> status=${res.status} clashCount=${res.clashCount} written=${res.clashesWritten}`);
      break;
    }
  }

  console.log(
    junk.length === 0
      ? '\n✓ STDOUT CLEAN — every stdout line was valid JSON-RPC'
      : `\n✗ STDOUT CORRUPTED — ${junk.length} non-JSON line(s):\n  ${junk.join('\n  ')}`,
  );
  child.kill();
  process.exit(junk.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[FAIL]', e.message); child.kill(); process.exit(1); });
