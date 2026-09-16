/**
 * Text extraction for PDFs, including drawings.
 *
 * Drawing exports (plans, sections, details) are ordinary PDFs whose text layer
 * holds the title block, revision table, room names and annotations — genuinely
 * searchable content. Scanned or fully rasterised sheets have no text layer at
 * all, and rather than returning an empty result that looks like "no match",
 * those pages are reported explicitly so the agent can say the drawing was seen
 * but is not machine-readable.
 */

import { readFileSync } from 'node:fs';
import { PDFParse } from 'pdf-parse';
import { splitText } from './chunk';
import type { ExtractionResult, TextChunk } from './types';

export async function extractPdf(filePath: string): Promise<ExtractionResult> {
  const parser = new PDFParse({ data: readFileSync(filePath) });
  let pages: { num: number; text: string }[];
  try {
    const result = await parser.getText();
    pages = result.pages.map((page) => ({ num: page.num, text: page.text }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read PDF text: ${message}`);
  } finally {
    await parser.destroy();
  }

  const chunks: TextChunk[] = [];
  const pagesWithoutText: number[] = [];

  for (const page of pages) {
    const pieces = splitText(page.text);
    if (!pieces.length) {
      pagesWithoutText.push(page.num);
      continue;
    }
    for (const text of pieces) {
      chunks.push({ page: page.num, location: `p. ${page.num}`, text });
    }
  }

  return {
    format: 'pdf',
    chunks,
    pageCount: pages.length,
    pagesWithoutText,
    note: noteFor(pages.length, pagesWithoutText.length),
  };
}

function noteFor(pageCount: number, withoutText: number): string | undefined {
  if (!withoutText) return undefined;
  if (withoutText === pageCount) {
    return (
      `None of the ${pageCount} page(s) carry a text layer — this is a scanned or fully ` +
      'rasterised PDF (common for photographed drawings). Nothing can be searched in it ' +
      'without OCR, which this server does not run.'
    );
  }
  return `${withoutText} of ${pageCount} page(s) carry no text layer and were skipped.`;
}
