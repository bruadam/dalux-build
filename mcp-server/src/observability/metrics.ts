import { createServer, type Server } from 'node:http';

/** A small Prometheus text-format registry. Labels are fixed vocabularies (tool, status, reason): no per-account labels. */
type Labels = Record<string, string>;

const counters = new Map<string, { help: string; values: Map<string, number> }>();
const histograms = new Map<string, { help: string; buckets: number[]; series: Map<string, { counts: number[]; sum: number; count: number }> }>();
const gauges = new Map<string, { help: string; read: () => number }>();

const labelKey = (labels: Labels) =>
  Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}="${value.replace(/[\\"\n]/g, '_')}"`)
    .join(',');

const braces = (key: string) => (key ? `{${key}}` : '');

export function incCounter(name: string, help: string, labels: Labels = {}, by = 1): void {
  const counter = counters.get(name) ?? { help, values: new Map() };
  counters.set(name, counter);
  const key = labelKey(labels);
  counter.values.set(key, (counter.values.get(key) ?? 0) + by);
}

export function observeHistogram(name: string, help: string, buckets: number[], value: number, labels: Labels = {}): void {
  const histogram = histograms.get(name) ?? { help, buckets, series: new Map() };
  histograms.set(name, histogram);
  const key = labelKey(labels);
  const series = histogram.series.get(key) ?? { counts: buckets.map(() => 0), sum: 0, count: 0 };
  histogram.series.set(key, series);
  buckets.forEach((bound, index) => {
    if (value <= bound) series.counts[index] += 1;
  });
  series.sum += value;
  series.count += 1;
}

export function setGauge(name: string, help: string, read: () => number): void {
  gauges.set(name, { help, read });
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, { help, values }] of counters) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
    for (const [key, value] of values) lines.push(`${name}${braces(key)} ${value}`);
  }
  for (const [name, { help, buckets, series }] of histograms) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} histogram`);
    for (const [key, data] of series) {
      const prefix = key ? `${key},` : '';
      buckets.forEach((bound, index) => lines.push(`${name}_bucket{${prefix}le="${bound}"} ${data.counts[index]}`));
      lines.push(`${name}_bucket{${prefix}le="+Inf"} ${data.count}`, `${name}_sum${braces(key)} ${data.sum}`, `${name}_count${braces(key)} ${data.count}`);
    }
  }
  for (const [name, { help, read }] of gauges) lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${read()}`);
  return `${lines.join('\n')}\n`;
}

export const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

export interface ToolCallMetric {
  tool: string;
  status: string;
  durationMs: number;
  denialReason?: string;
  daluxErrors?: number;
  daluxRateLimited?: number;
}

export function recordToolCall(call: ToolCallMetric): void {
  incCounter('dalux_mcp_tool_calls_total', 'Tool calls by tool and outcome.', { tool: call.tool, status: call.status });
  observeHistogram('dalux_mcp_tool_duration_seconds', 'Tool call duration.', LATENCY_BUCKETS, call.durationMs / 1000);
  if (call.denialReason) incCounter('dalux_mcp_denials_total', 'Denied tool calls by reason.', { reason: call.denialReason });
  if (call.daluxErrors) incCounter('dalux_mcp_dalux_errors_total', 'Failed Dalux API calls.', {}, call.daluxErrors);
  if (call.daluxRateLimited) incCounter('dalux_mcp_dalux_rate_limited_total', 'Dalux API calls answered with a rate limit.', {}, call.daluxRateLimited);
}

export function recordAuthFailure(reason: string): void {
  incCounter('dalux_mcp_auth_failures_total', 'Failed authentication attempts by reason.', { reason });
}

export function recordAuditWriteFailure(): void {
  incCounter('dalux_mcp_audit_write_failures_total', 'Audit rows that could not be written.');
}

const SESSION_WINDOW_MS = 5 * 60_000;
const lastSeen = new Map<string, number>();

/** A credential (API token or OAuth session) counts as an active session for five minutes after its last request. */
export function touchSession(credentialId: string, now = Date.now()): void {
  lastSeen.set(credentialId, now);
}

setGauge('dalux_mcp_active_sessions', 'Credentials that made a request in the last five minutes.', () => {
  const cutoff = Date.now() - SESSION_WINDOW_MS;
  for (const [id, at] of lastSeen) if (at < cutoff) lastSeen.delete(id);
  return lastSeen.size;
});

/** /metrics on its own port, which the reverse proxy does not route to. */
export function startMetricsServer(port: number, host = '0.0.0.0'): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url?.split('?')[0] !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(renderMetrics());
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
