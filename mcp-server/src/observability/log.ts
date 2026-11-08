/**
 * One JSON object per line, for log shippers (Loki, ELK). Platform mode writes to stdout. Stdio and Dalux-header
 * mode write to stderr, and only when DALUX_MCP_LOG_JSON=1, because stdout is the protocol channel on stdio.
 * Lines never hold tokens, keys, document or task text, or search text.
 */
type Sink = 'stdout' | 'stderr' | 'off';

let sink: Sink = process.env.DALUX_MCP_LOG_JSON === '1' ? 'stderr' : 'off';

export function setLogSink(next: Sink): void {
  sink = next;
}

export function logJson(fields: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info'): void {
  if (sink === 'off') return;
  const entry = Object.fromEntries(Object.entries({ timestamp: new Date().toISOString(), level, ...fields }).filter(([, value]) => value !== undefined));
  (sink === 'stdout' ? process.stdout : process.stderr).write(`${JSON.stringify(entry)}\n`);
}
