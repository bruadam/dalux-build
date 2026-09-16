/**
 * A hand-assembled, uncompressed PDF writer.
 *
 * Enough of the format to exercise the real parser: a page whose content stream
 * draws text, and a page that draws none — which is what a scanned drawing
 * looks like to a text extractor.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

function textStream(lines: string[]): string {
  const escaped = lines.map((line) => line.replace(/([()\\])/g, '\\$1'));
  const drawn = escaped
    .map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${line}) Tj ET`)
    .join('\n');
  return drawn;
}

/** Write a PDF with one page per entry; an empty array of lines yields a page with no text. */
export function writePdf(dir: string, name: string, pages: string[][]): string {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Object 1 is the catalog and 2 the page tree; both are patched once the
  // page objects below have been allocated their numbers.
  add('');
  add('');
  const fontNumber = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageNumbers: number[] = [];
  for (const lines of pages) {
    const content = textStream(lines);
    const contentNumber = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    pageNumbers.push(
      add(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
          `/Resources << /Font << /F1 ${fontNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`,
      ),
    );
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] =
    `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNumbers.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const target = path.join(dir, name);
  writeFileSync(target, pdf, 'latin1');
  return target;
}
