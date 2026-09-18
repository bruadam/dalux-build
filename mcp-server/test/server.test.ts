import { z } from 'zod';
import { TOOLS, toolResultContent } from '../src/server';

describe('TOOLS registry', () => {
  it('has 58 tools with unique names', () => {
    expect(TOOLS).toHaveLength(58);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has a non-empty description and a zod object input schema', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeInstanceOf(z.ZodObject);
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('does not expose any mutating (create/update/delete) operation', () => {
    // These write to (or delete from) the local disposable cache, not to
    // Dalux — no project data is mutated by any of them. report_feedback is
    // the one deliberate exception (a real GitHub issue on this server's own
    // repo, not Dalux) — it doesn't match this naming pattern, but see the
    // dedicated test below for its confirmation gate.
    const allowlist = new Set([
      'download_file',
      'search_pdf_content',
      'search_file_content',
      'build_file_area_index',
      'drop_file_area_index',
    ]);
    for (const tool of TOOLS) {
      if (allowlist.has(tool.name)) continue;
      expect(tool.name).not.toMatch(/^(create|update|delete|upload|finish)_/);
    }
  });

  it('gates report_feedback\'s input schema on an optional confirmed flag', () => {
    const tool = TOOLS.find((t) => t.name === 'report_feedback');
    expect(tool).toBeDefined();
    const shape = (tool!.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
    expect(shape.confirmed).toBeInstanceOf(z.ZodOptional);
  });
});

describe('toolResultContent', () => {
  it('renders a plain result as a single text block', () => {
    expect(toolResultContent({ found: true })).toEqual([{ type: 'text', text: '{"found":true}' }]);
  });

  it('renders an `image` field as an image content block plus the rest as text', () => {
    const result = toolResultContent({ image: { mimeType: 'image/png', data: 'AAAA' }, page: 1 });
    expect(result).toEqual([
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      { type: 'text', text: '{"page":1}' },
    ]);
  });

  it('renders a `resource` field as plain text — this MCP host has no support for embedded-resource content blocks', () => {
    // download_file/download_task_attachment used to emit a `resource` content block for arbitrary
    // binary content; at least one real MCP host hard-errors on it regardless of mimeType, so
    // tools/documents.ts and tools/tasks.ts no longer produce a `resource` field at all (see
    // inlineText.ts/downloadLinks.ts for what replaced it). This just guards against it silently
    // coming back — an object with a `resource` field should fall through to the plain-text path.
    const result = toolResultContent({ resource: { uri: 'x', mimeType: 'application/pdf', blob: 'AAAA' }, found: true });
    expect(result).toEqual([{ type: 'text', text: '{"resource":{"uri":"x","mimeType":"application/pdf","blob":"AAAA"},"found":true}' }]);
  });
});
