/**
 * Is the clash job actually backgrounded, or does it block the MCP server?
 * Fire ifc_clash_start without awaiting it, then ping with a trivial
 * tools/list. If the ping is answered promptly the job is genuinely async;
 * if both stall until the clash finishes, the event loop is blocked.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const child = spawn('node', [path.resolve('dist/cli.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
const t0 = Date.now();
const ms = () => String(Date.now() - t0).padStart(6);

let buffer = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (c) => {
  buffer += c.toString();
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    try {
      const m = JSON.parse(line);
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); p(m); }
    } catch { console.log(`${ms()}ms  NON-JSON on stdout: ${line.slice(0, 100)}`); }
  }
});
child.stderr.on('data', (d) => console.log(`${ms()}ms  [stderr] ${d.toString().trim().slice(0, 100)}`));

function send(method, params, label) {
  const id = nextId++;
  const sentAt = Date.now();
  console.log(`${ms()}ms  -> ${label ?? method}`);
  const p = new Promise((res) => pending.set(id, res));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  p.then(() => console.log(`${ms()}ms  <- ${label ?? method} (took ${Date.now() - sentAt}ms)`));
  return p;
}

const TEKLA = { projectId: 'S313578016888324096', fileAreaId: 'S313578021116182528', fileId: 'S376341429678505988' };

async function main() {
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'b', version: '0' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await send('tools/list', {}, 'tools/list (warmup)');

  // Do NOT await: we want to see whether the server stays responsive.
  send('tools/call', { name: 'ifc_clash_start', arguments: TEKLA }, 'ifc_clash_start');

  for (const delay of [500, 2000, 5000, 10000, 20000]) {
    await new Promise((r) => setTimeout(r, delay === 500 ? 500 : delay - 0));
    send('tools/list', {}, `ping@${delay}ms`);
  }

  await new Promise((r) => setTimeout(r, 30000));
  console.log(`${ms()}ms  done`);
  child.kill();
  process.exit(0);
}
main();
