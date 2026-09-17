/**
 * Runtime bridge to ifc-lite.
 *
 * ifc-lite is ESM-only while this server builds to CJS, so it is reached
 * through a runtime `import()` (kept intact by esbuild because tsup marks
 * `@ifc-lite/*` external). The module is loaded once and memoised.
 */
import type { ModelRegistry, ToolContext } from '@ifc-lite/mcp';

type IfcLite = typeof import('@ifc-lite/mcp');
type IfcClash = typeof import('@ifc-lite/clash');
type IfcClashStep = typeof import('@ifc-lite/clash/step');
type IfcGeometry = typeof import('@ifc-lite/geometry');

let modulePromise: Promise<IfcLite> | null = null;
let clashModulePromise: Promise<IfcClash> | null = null;
let clashStepModulePromise: Promise<IfcClashStep> | null = null;
let geometryModulePromise: Promise<IfcGeometry> | null = null;
let consoleRedirected = false;

/**
 * ifc-lite reports geometry diagnostics ("[IFC-LITE] CSG diagnostics: …")
 * through console.log/info/warn, which land on stdout — and on our default
 * stdio transport stdout carries the JSON-RPC framing, so those lines would
 * corrupt the stream.
 *
 * Redirect those three to stderr permanently rather than around each call.
 * Swapping `process.stdout.write` for the duration of a call looked tighter but
 * was actively wrong: the swap is process-wide while the server is concurrent,
 * so a response emitted during a clash run went to stderr and the client hung
 * waiting for it. Guarding the console methods leaves the transport's own
 * `process.stdout.write` untouched, and the worst case — diverting some
 * unrelated console.log to stderr — cannot break the protocol.
 *
 * console.error already goes to stderr and is what this server logs with, so it
 * is deliberately left alone.
 */
function redirectIfcLiteLogging(): void {
  if (consoleRedirected) return;
  consoleRedirected = true;
  for (const level of ['log', 'info', 'warn'] as const) {
    console[level] = (...args: unknown[]) => console.error(...args);
  }
}

export function loadIfcLite(): Promise<IfcLite> {
  // Installed here because this is the only route to ifc-lite, so the guard is
  // always in place before any of its code can run.
  redirectIfcLiteLogging();
  modulePromise ??= import('@ifc-lite/mcp');
  return modulePromise;
}

/**
 * The representation-agnostic clash engine underneath @ifc-lite/mcp's
 * clash_check/clash_matrix tools. Reached directly (rather than through
 * callIfcTool) for cross-model runs: ClashElement carries a `model` field and
 * the engine takes a flat element array, so it has no single-model limit —
 * only the MCP tool wrapper does. See ../ifc/clashEngine.ts.
 */
export function loadIfcClash(): Promise<IfcClash> {
  redirectIfcLiteLogging();
  clashModulePromise ??= import('@ifc-lite/clash');
  return clashModulePromise;
}

/** STEP/IFC adapter (`@ifc-lite/clash/step`): turns a parsed model's meshes into ClashElements. */
export function loadIfcClashStep(): Promise<IfcClashStep> {
  clashStepModulePromise ??= import('@ifc-lite/clash/step');
  return clashStepModulePromise;
}

/** Headless geometry/tessellation pipeline used to mesh a model before clashing. */
export function loadIfcGeometry(): Promise<IfcGeometry> {
  geometryModulePromise ??= import('@ifc-lite/geometry');
  return geometryModulePromise;
}

/**
 * Build the context ifc-lite tool handlers expect.
 *
 * We call `tool.handler()` directly instead of standing up an ifc-lite
 * MCPServer, which means ifc-lite's scope gating never runs — a handler
 * executes whatever `scope` this context carries. The curated tool surface in
 * ../tools/ifc.ts is therefore the only thing keeping entity_delete /
 * model_save / entity_create out of reach. Do not widen it.
 */
export async function buildToolContext(
  registry: ModelRegistry,
  signal: AbortSignal,
): Promise<ToolContext> {
  const ifc = await loadIfcLite();
  return {
    registry,
    scope: ifc.READ_ONLY,
    progress: ifc.NOOP_PROGRESS,
    log: ifc.SILENT_LOGGER,
    signal,
    config: { ...ifc.DEFAULT_CONFIG, readOnly: true },
  };
}

/** Call a stock ifc-lite tool, normalising its two failure modes into throws. */
export async function callIfcTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<{ text: string; data: Record<string, unknown> }> {
  const ifc = await loadIfcLite();
  const tool = ifc.buildDefaultToolRegistry().get(name);
  if (!tool) throw new Error(`ifc-lite tool not available: ${name}`);
  // Some handlers throw (SelectorUnsupportedError, and a raw TypeError when a
  // required argument is missing) rather than returning isError, so both paths
  // have to be funnelled into one.
  const result = await tool.handler(input, ctx);
  const text = (result.content ?? [])
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n');
  if (result.isError) throw new Error(text || `ifc-lite tool ${name} failed`);
  return { text, data: (result.structuredContent ?? {}) as Record<string, unknown> };
}
