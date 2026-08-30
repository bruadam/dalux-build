import { z } from 'zod';
import { TOOLS } from '../src/server';

describe('TOOLS registry', () => {
  it('has 28 tools with unique names', () => {
    expect(TOOLS).toHaveLength(28);
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
    // download_file/search_pdf_content are the two explicitly-allowed exceptions:
    // they write to a local cache, not to Dalux — no Dalux data is mutated.
    const allowlist = new Set(['download_file', 'search_pdf_content']);
    for (const tool of TOOLS) {
      if (allowlist.has(tool.name)) continue;
      expect(tool.name).not.toMatch(/^(create|update|delete|upload|finish)_/);
    }
  });
});
