import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { extractDocument } from '../src/extract';
import { writePdf } from './fixtures/pdf';

describe('extract pdf', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-pdf-'));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('extracts text per page and cites the page number', async () => {
    const file = writePdf(dir, 'spec.pdf', [
      ['Section 1 - Concrete', 'Slabs shall be C30/37.'],
      ['Section 2 - Doors', 'Escape doors shall be EI60.'],
    ]);

    const result = await extractDocument(file);

    expect(result.format).toBe('pdf');
    expect(result.pageCount).toBe(2);
    expect(result.pagesWithoutText).toEqual([]);
    expect(result.note).toBeUndefined();
    expect(result.chunks[0]).toMatchObject({ page: 1, location: 'p. 1' });
    expect(result.chunks[0].text).toContain('C30/37');
    expect(result.chunks[1]).toMatchObject({ page: 2, location: 'p. 2' });
    expect(result.chunks[1].text).toContain('EI60');
  });

  it('reads the annotations a drawing carries in its text layer', async () => {
    const file = writePdf(dir, 'K31_H1_E1_N003.pdf', [
      ['104 OFFICE SPACE (31 PERS) 133,13 m2', '148 STAIRCASE 25,58 m2', 'Rev. C 2026-02-11'],
    ]);

    const result = await extractDocument(file);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('OFFICE SPACE');
    expect(result.chunks[0].text).toContain('Rev. C');
  });

  it('reports a page with no text layer rather than returning it as an empty match', async () => {
    const file = writePdf(dir, 'scanned.pdf', [['Title block only'], []]);

    const result = await extractDocument(file);

    expect(result.pageCount).toBe(2);
    expect(result.pagesWithoutText).toEqual([2]);
    expect(result.note).toBe('1 of 2 page(s) carry no text layer and were skipped.');
    expect(result.chunks.every((chunk) => chunk.page === 1)).toBe(true);
  });

  it('says plainly that a fully scanned PDF cannot be searched without OCR', async () => {
    const file = writePdf(dir, 'raster.pdf', [[], []]);

    const result = await extractDocument(file);

    expect(result.chunks).toHaveLength(0);
    expect(result.note).toMatch(/scanned or fully rasterised/);
    expect(result.note).toMatch(/without OCR/);
  });

  it('fails with a readable message when the file is not a PDF at all', async () => {
    const file = writePdf(dir, 'ok.pdf', [['fine']]);
    const broken = path.join(dir, 'broken.pdf');
    rmSync(broken, { force: true });
    require('node:fs').writeFileSync(broken, 'this is not a pdf');

    await expect(extractDocument(broken)).rejects.toThrow(/Could not read PDF text/);
    await expect(extractDocument(file)).resolves.toBeDefined();
  });
});
