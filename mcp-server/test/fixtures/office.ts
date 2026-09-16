/**
 * Builders for minimal-but-real .docx/.xlsx files.
 *
 * The extractors parse the actual OOXML parts, so the tests feed them actual
 * zip archives rather than mocking the parse step away — that is the only way
 * a test can catch, say, shared strings being resolved by the wrong index.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

function write(dir: string, name: string, files: Record<string, string>): string {
  const target = path.join(dir, name);
  const entries = Object.fromEntries(
    Object.entries(files).map(([entry, xml]) => [entry, strToU8(xml)]),
  );
  writeFileSync(target, Buffer.from(zipSync(entries)));
  return target;
}

export function writeDocx(dir: string, name: string, bodyXml: string): string {
  return write(dir, name, {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'word/document.xml':
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${bodyXml}</w:body></w:document>`,
  });
}

export function paragraph(text: string, style?: string): string {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

export function tableRow(...cells: string[]): string {
  const rendered = cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join('');
  return `<w:tr>${rendered}</w:tr>`;
}

export interface SheetSpec {
  name: string;
  /** Rows of cell values; empty strings become empty cells. */
  rows: string[][];
}

const COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function writeXlsx(dir: string, name: string, sheets: SheetSpec[]): string {
  const strings: string[] = [];
  const indexOf = (value: string) => {
    const existing = strings.indexOf(value);
    if (existing >= 0) return existing;
    strings.push(value);
    return strings.length - 1;
  };

  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
  };

  const sheetTags: string[] = [];
  const relationshipTags: string[] = [];

  sheets.forEach((sheet, sheetIndex) => {
    const part = `worksheets/sheet${sheetIndex + 1}.xml`;
    sheetTags.push(`<sheet name="${sheet.name}" sheetId="${sheetIndex + 1}" r:id="rId${sheetIndex + 1}"/>`);
    relationshipTags.push(`<Relationship Id="rId${sheetIndex + 1}" Target="${part}"/>`);

    const rows = sheet.rows
      .map((cells, rowIndex) => {
        const rendered = cells
          .map((value, columnIndex) => {
            if (!value) return '';
            const ref = `${COLUMNS[columnIndex]}${rowIndex + 1}`;
            return Number.isNaN(Number(value))
              ? `<c r="${ref}" t="s"><v>${indexOf(value)}</v></c>`
              : `<c r="${ref}"><v>${value}</v></c>`;
          })
          .join('');
        return `<row r="${rowIndex + 1}">${rendered}</row>`;
      })
      .join('');
    files[`xl/${part}`] = `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
  });

  files['xl/workbook.xml'] = `<?xml version="1.0"?><workbook><sheets>${sheetTags.join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] =
    `<?xml version="1.0"?><Relationships>${relationshipTags.join('')}</Relationships>`;
  files['xl/sharedStrings.xml'] =
    `<?xml version="1.0"?><sst>${strings.map((value) => `<si><t>${value}</t></si>`).join('')}</sst>`;

  return write(dir, name, files);
}
