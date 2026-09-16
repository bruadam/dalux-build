import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { extractDocument } from '../src/extract';

describe('extract markdown', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-md-'));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function write(name: string, content: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, content, 'utf-8');
    return file;
  }

  it('cites the ATX heading in effect for a passage', async () => {
    const file = write(
      'law.md',
      ['# Example Act', '', '## Section 1 — Duty holders', '', 'The principal contractor is responsible for site safety.'].join('\n'),
    );

    const result = await extractDocument(file);

    expect(result.format).toBe('md');
    expect(result.note).toBeUndefined();
    // Short content packs into one chunk labelled with the first heading in force.
    expect(result.chunks[0].location).toBe('§ Example Act');
    expect(result.chunks[0].text).toContain('Section 1 — Duty holders');
    expect(result.chunks[0].text).toContain('principal contractor is responsible for site safety');
  });

  it('does not treat headings inside fenced code blocks as real headings', async () => {
    const file = write(
      'snippet.md',
      ['# Real heading', '', '```', '# not a heading', 'still just code', '```', '', 'Body text after the fence.'].join('\n'),
    );

    const result = await extractDocument(file);

    const codeChunk = result.chunks.find((chunk) => chunk.text.includes('not a heading'));
    expect(codeChunk?.location).toBe('§ Real heading');
    const bodyChunk = result.chunks.find((chunk) => chunk.text.includes('Body text after the fence'));
    expect(bodyChunk?.location).toBe('§ Real heading');
  });

  it('falls back to a paragraph range when there is no heading yet', async () => {
    const file = write('no-heading.md', 'Just a first line before any heading appears.');

    const result = await extractDocument(file);

    expect(result.chunks[0].location).toBe('¶ 1–1');
  });

  it('reports empty content rather than throwing', async () => {
    const file = write('empty.md', '   \n\n  ');

    const result = await extractDocument(file);

    expect(result.chunks).toEqual([]);
    expect(result.note).toMatch(/no extractable text/);
  });
});
