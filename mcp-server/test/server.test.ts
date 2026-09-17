import { z } from 'zod';
import { TOOLS } from '../src/server';

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
