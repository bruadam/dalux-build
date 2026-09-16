import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { extractDocument } from '../src/extract';

describe('extract html', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-html-'));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function write(name: string, content: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, content, 'utf-8');
    return file;
  }

  it('cites the heading in effect and strips markup', async () => {
    const file = write(
      'guideline.html',
      `<html><body>
        <h1>Example Guideline</h1>
        <h2>2. PPE</h2>
        <ul>
          <li>Hard hats are <strong>mandatory</strong> in all active work areas.</li>
        </ul>
      </body></html>`,
    );

    const result = await extractDocument(file);

    expect(result.format).toBe('html');
    expect(result.note).toBeUndefined();
    // Short content packs into one chunk labelled with the first heading in force.
    expect(result.chunks[0].location).toBe('§ Example Guideline');
    expect(result.chunks[0].text).toContain('2. PPE');
    expect(result.chunks[0].text).toContain('Hard hats are mandatory in all active work areas.');
    expect(result.chunks[0].text).not.toContain('<');
  });

  it('drops script and style content rather than surfacing it as prose', async () => {
    const file = write(
      'with-script.html',
      `<html><head><style>body{color:red}</style></head><body>
        <script>alert('nope')</script>
        <p>Real paragraph text.</p>
      </body></html>`,
    );

    const result = await extractDocument(file);

    const text = result.chunks.map((chunk) => chunk.text).join(' ');
    expect(text).toContain('Real paragraph text');
    expect(text).not.toMatch(/alert|color:red/);
  });

  it('decodes HTML entities', async () => {
    const file = write('entities.html', '<p>Fire &amp; safety &mdash; minimum rating &ge; REI&nbsp;90.</p>');

    const result = await extractDocument(file);

    expect(result.chunks[0].text).toBe('Fire & safety — minimum rating &ge; REI 90.');
  });

  it('reports empty content rather than throwing', async () => {
    const file = write('empty.html', '<html><head><title>Empty</title></head><body></body></html>');

    const result = await extractDocument(file);

    expect(result.chunks).toEqual([]);
    expect(result.note).toMatch(/no extractable text/);
  });
});
