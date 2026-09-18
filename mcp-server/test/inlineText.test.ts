import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildInlineText, HARD_MAX_INLINE_CHARS, maxInlineChars } from '../src/inlineText';
import { paragraph, writeDocx } from './fixtures/office';
import { writePdf } from './fixtures/pdf';

describe('inlineText', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-inline-text-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('maxInlineChars', () => {
    it('defaults to 200,000', () => {
      delete process.env.DALUX_MCP_MAX_INLINE_CHARS;
      expect(maxInlineChars()).toBe(200_000);
    });

    it('honours a per-call override', () => {
      expect(maxInlineChars(500)).toBe(500);
    });

    it('clamps a per-call override to the hard ceiling', () => {
      expect(maxInlineChars(HARD_MAX_INLINE_CHARS * 10)).toBe(HARD_MAX_INLINE_CHARS);
    });
  });

  describe('buildInlineText', () => {
    it('extracts a PDF\'s text', async () => {
      const filePath = writePdf(dir, 'spec.pdf', [['Fire rating EI60 required.']]);

      const result = await buildInlineText(filePath, 'spec.pdf');

      expect(result.inlined).toBe(true);
      if (!result.inlined) throw new Error('expected inlined result');
      expect(result.format).toBe('pdf');
      expect(result.text).toContain('Fire rating EI60 required');
      expect(result.truncated).toBe(false);
    });

    it('extracts a Word document\'s text with its heading anchor', async () => {
      const filePath = writeDocx(
        dir,
        'contract.docx',
        [paragraph('7 Retention', 'Heading1'), paragraph('Five percent withheld until handover.')].join(''),
      );

      const result = await buildInlineText(filePath, 'contract.docx');

      expect(result.inlined).toBe(true);
      if (!result.inlined) throw new Error('expected inlined result');
      expect(result.text).toContain('§ 7 Retention');
      expect(result.text).toContain('Five percent withheld');
    });

    it('truncates text past the character cap and reports it', async () => {
      const filePath = writePdf(dir, 'spec.pdf', [['Fire rating EI60 required.']]);

      const result = await buildInlineText(filePath, 'spec.pdf', 5);

      expect(result.inlined).toBe(true);
      if (!result.inlined) throw new Error('expected inlined result');
      expect(result.truncated).toBe(true);
      expect(result.text.length).toBe(5);
    });

    it('reports no extraction available for an unsupported format', async () => {
      const filePath = path.join(dir, 'model.dwg');
      writeFileSync(filePath, 'cad bytes');

      const result = await buildInlineText(filePath, 'model.dwg');

      expect(result.inlined).toBe(false);
      if (result.inlined) throw new Error('expected non-inlined result');
      expect(result.reason).toContain('No text extraction available');
    });
  });
});
