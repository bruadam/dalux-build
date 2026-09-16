/**
 * Runtime bridge to ifc-lite.
 *
 * ifc-lite is ESM-only while this server builds to CJS, so it is reached
 * through a runtime `import()` (kept intact by esbuild because tsup marks
 * `@ifc-lite/*` external). The module is loaded once and memoised.
 */
import type { ModelRegistry, ToolContext } from '@ifc-lite/mcp';

type IfcLite = typeof import('@ifc-lite/mcp');

let modulePromise: Promise<IfcLite> | null = null;

export function loadIfcLite(): Promise<IfcLite> {
  modulePromise ??= import('@ifc-lite/mcp');
  return modulePromise;
}

/**
 * ifc-lite writes geometry diagnostics ("[IFC-LITE] CSG diagnostics: …") to
 * stdout. On our default stdio transport stdout carries the JSON-RPC framing,
 * so an unguarded call corrupts the stream. Redirect stdout to stderr for the
 * duration of `fn` — stderr is already where this server logs.
 */
export async function withQuietStdout<T>(fn: () => Promise<T>): Promise<T> {
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const encoding = typeof rest[0] === 'string' ? (rest[0] as BufferEncoding) : undefined;
    const callback = rest.find((r) => typeof r === 'function') as ((e?: Error | null) => void) | undefined;
    process.stderr.write(chunk, encoding as BufferEncoding);
    callback?.(null);
    return true;
  }) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = realWrite;
  }
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
  const result = await withQuietStdout(async () => tool.handler(input, ctx));
  const text = (result.content ?? [])
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n');
  if (result.isError) throw new Error(text || `ifc-lite tool ${name} failed`);
  return { text, data: (result.structuredContent ?? {}) as Record<string, unknown> };
}
