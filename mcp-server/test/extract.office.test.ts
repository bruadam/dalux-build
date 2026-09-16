import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { extractDocument, formatFor, isSupported, UnsupportedFormatError } from '../src/extract';
import { paragraph, tableRow, writeDocx, writeXlsx } from './fixtures/office';

describe('extract', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-extract-'));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  describe('format detection', () => {
    it('recognises the Office and PDF extensions, including macro-enabled ones', () => {
      expect(formatFor('Tender.docx')).toBe('docx');
      expect(formatFor('Tender.DOCM')).toBe('docx');
      expect(formatFor('Budget.xlsm')).toBe('xlsx');
      expect(formatFor('K01_F03.pdf')).toBe('pdf');
      expect(isSupported('model.ifc')).toBe(false);
    });

    it('rejects formats it cannot read, naming the ones it can', async () => {
      const file = path.join(dir, 'legacy.doc');
      writeFileSync(file, 'not really a doc');
      await expect(extractDocument(file)).rejects.toBeInstanceOf(UnsupportedFormatError);
      await expect(extractDocument(file)).rejects.toThrow('.docx');
    });
  });

  describe('docx', () => {
    it('extracts paragraphs and table rows, and cites the heading in force', async () => {
      const file = writeDocx(
        dir,
        'contract.docx',
        [
          paragraph('1 Scope', 'Heading1'),
          paragraph('The works comprise the foundation slab.'),
          paragraph('4 Betaling', 'Overskrift1'),
          paragraph('Invoicing is monthly &amp; net 30.'),
          `<w:tbl>${tableRow('Post', 'Beløb')}${tableRow('Beton', '120.000 DKK')}</w:tbl>`,
        ].join(''),
      );

      const result = await extractDocument(file);

      expect(result.format).toBe('docx');
      const text = result.chunks.map((chunk) => chunk.text).join('\n');
      expect(text).toContain('The works comprise the foundation slab.');
      // Table cells are joined per row, so a row stays readable as a unit.
      expect(text).toContain('Beton | 120.000 DKK');
      expect(text).toContain('Invoicing is monthly & net 30.');
      // The Danish style id must be recognised as a heading, not body text.
      expect(result.chunks[0].location).toBe('§ 1 Scope');
      expect(result.chunks[0].page).toBeNull();
    });

    it('ignores tracked deletions, which are not part of the document text', async () => {
      const file = writeDocx(
        dir,
        'redlined.docx',
        '<w:p><w:r><w:t>Retention is </w:t></w:r><w:del><w:r><w:delText>ten</w:delText></w:r></w:del>' +
          '<w:r><w:t>five percent.</w:t></w:r></w:p>',
      );

      const result = await extractDocument(file);

      expect(result.chunks[0].text).toBe('Retention is five percent.');
    });

    it('reports a document with no extractable text instead of returning silence', async () => {
      const file = writeDocx(dir, 'images-only.docx', '<w:p><w:r><w:drawing/></w:r></w:p>');

      const result = await extractDocument(file);

      expect(result.chunks).toHaveLength(0);
      expect(result.note).toMatch(/no extractable text/i);
    });
  });

  describe('xlsx', () => {
    it('labels each cell with its column header and cites sheet and rows', async () => {
      const file = writeXlsx(dir, 'budget.xlsx', [
        {
          name: 'Budget',
          rows: [
            ['Description', 'Qty', 'Unit'],
            ['Concrete C30/37', '120', 'm3'],
            ['Reinforcement', '18', 't'],
          ],
        },
      ]);

      const result = await extractDocument(file);

      expect(result.format).toBe('xlsx');
      expect(result.chunks).toHaveLength(1);
      const [chunk] = result.chunks;
      expect(chunk.text).toContain('[Sheet: Budget]');
      expect(chunk.text).toContain('Columns: Description | Qty | Unit');
      expect(chunk.text).toContain('Row 2: Description=Concrete C30/37 | Qty=120 | Unit=m3');
      expect(chunk.location).toBe('Budget!rows 2–3');
    });

    it('keeps sheets separate so a match can name the sheet it came from', async () => {
      const file = writeXlsx(dir, 'multi.xlsx', [
        { name: 'Doors', rows: [['Mark', 'Rating'], ['D01', 'EI60']] },
        { name: 'Windows', rows: [['Mark', 'U-value'], ['W01', '1.2']] },
      ]);

      const result = await extractDocument(file);

      expect(result.chunks.map((chunk) => chunk.location)).toEqual(['Doors!rows 2–2', 'Windows!rows 2–2']);
      expect(result.chunks[0].text).toContain('Mark=D01 | Rating=EI60');
    });
  });
});
