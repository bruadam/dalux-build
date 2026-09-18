import { z } from 'zod';
import { TOOLS, toolResultContent } from '../src/server';

describe('TOOLS registry', () => {
  it('has 55 tools with unique names', () => {
    expect(TOOLS).toHaveLength(55);
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
    // Dalux — no project data is mutated by any of them.
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

  it('renders a `resource` field as an embedded-resource content block plus the rest as text', () => {
    const resource = { uri: 'dalux-mcp://file/spec.pdf', mimeType: 'application/pdf', blob: 'AAAA' };
    const result = toolResultContent({ resource, found: true, filePath: '/tmp/spec.pdf' });
    expect(result).toEqual([
      { type: 'resource', resource },
      { type: 'text', text: '{"found":true,"filePath":"/tmp/spec.pdf"}' },
    ]);
  });
});
