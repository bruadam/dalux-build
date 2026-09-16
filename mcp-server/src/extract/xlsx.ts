/**
 * Text extraction for Excel workbooks (.xlsx / .xlsm).
 *
 * A spreadsheet only makes sense with its header row attached, so rows are
 * rendered as "Row 14: Description=Concrete C30/37 | Qty=120 | Unit=m3" and
 * every chunk is prefixed with the sheet name and header line. That costs a few
 * tokens per chunk and buys passages an LLM can actually quantify from — a bare
 * "120 | m3" retrieved out of context is worthless.
 */

import { attr, collectTextElements, entryText, entryNames, readOoxmlEntries } from './ooxml';
import { packLines } from './chunk';
import type { ExtractionResult, TextChunk } from './types';

/** Caps keeping a 200k-row export from exhausting memory or the index budget. */
const MAX_ROWS_PER_SHEET = 5000;
const MAX_CELL_CHARS = 200;

interface Sheet {
  name: string;
  part: string;
}

function sharedStrings(entries: Record<string, Uint8Array>): string[] {
  const xml = entryText(entries, 'xl/sharedStrings.xml');
  if (!xml) return [];
  const out: string[] = [];
  for (const match of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    // Phonetic guides (<rPh>) duplicate the base text — drop them before
    // concatenating the remaining <t> runs of a rich-text string.
    out.push(collectTextElements(match[1].replace(/<rPh[\s\S]*?<\/rPh>/g, ''), 't'));
  }
  return out;
}

/** Sheet display names in workbook order, resolved to their worksheet parts via rels. */
function sheets(entries: Record<string, Uint8Array>): Sheet[] {
  const workbook = entryText(entries, 'xl/workbook.xml');
  const rels = entryText(entries, 'xl/_rels/workbook.xml.rels');

  const targets = new Map<string, string>();
  if (rels) {
    for (const match of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      const id = attr(match[0], 'Id');
      const target = attr(match[0], 'Target');
      if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\.\//, ''));
    }
  }

  const found: Sheet[] = [];
  if (workbook) {
    for (const match of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
      const name = attr(match[0], 'name');
      const rid = attr(match[0], 'r:id') ?? attr(match[0], 'relationshipId');
      const target = rid ? targets.get(rid) : null;
      if (name && target) found.push({ name, part: `xl/${target}` });
    }
  }
  if (found.length) return found.filter((sheet) => entries[sheet.part]);

  // Malformed or unusual workbooks: fall back to the worksheet parts on disk.
  return entryNames(entries, /^xl\/worksheets\/sheet\d+\.xml$/).map((part, i) => ({
    name: `Sheet${i + 1}`,
    part,
  }));
}

function columnOf(ref: string): string {
  return ref.replace(/\d+$/, '');
}

interface Row {
  number: number;
  cells: { column: string; value: string }[];
}

function rowsOf(sheetXml: string, strings: string[]): { rows: Row[]; truncated: boolean } {
  const rows: Row[] = [];
  let truncated = false;

  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_ROWS_PER_SHEET) {
      truncated = true;
      break;
    }
    const number = Number(attr(`<row${rowMatch[1]}>`, 'r') ?? rows.length + 1);
    const cells: { column: string; value: string }[] = [];

    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const openingTag = `<c${cellMatch[1]}>`;
      const ref = attr(openingTag, 'r') ?? '';
      const type = attr(openingTag, 't') ?? 'n';
      const body = cellMatch[2] ?? '';

      let value: string;
      if (type === 's') {
        value = strings[Number(collectTextElements(body, 'v'))] ?? '';
      } else if (type === 'inlineStr') {
        value = collectTextElements(body, 't');
      } else if (type === 'b') {
        value = collectTextElements(body, 'v') === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'e') {
        value = '';
      } else {
        // Numbers (including date serials, which are left raw — reformatting
        // them needs the number-format table and is not worth it for search).
        value = collectTextElements(body, 'v');
      }

      value = value.replace(/\s+/g, ' ').trim();
      if (!value) continue;
      cells.push({
        column: columnOf(ref) || String(cells.length + 1),
        value: value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value,
      });
    }

    if (cells.length) rows.push({ number, cells });
  }

  return { rows, truncated };
}

/** First row that looks like labels rather than data, used to name later columns. */
function headerRow(rows: Row[]): Row | null {
  for (const row of rows.slice(0, 10)) {
    if (row.cells.length >= 2 && row.cells.every((cell) => Number.isNaN(Number(cell.value)))) {
      return row;
    }
  }
  return null;
}

export function extractXlsx(filePath: string): ExtractionResult {
  const entries = readOoxmlEntries(filePath);
  const strings = sharedStrings(entries);
  const workbookSheets = sheets(entries);
  if (!workbookSheets.length) {
    throw new Error('Not an Excel workbook: no worksheet parts found in the archive.');
  }

  const chunks: TextChunk[] = [];
  let truncated = false;

  for (const sheet of workbookSheets) {
    const sheetXml = entryText(entries, sheet.part);
    if (!sheetXml) continue;

    const { rows, truncated: sheetTruncated } = rowsOf(sheetXml, strings);
    truncated = truncated || sheetTruncated;
    if (!rows.length) continue;

    const header = headerRow(rows);
    const labels = new Map(header?.cells.map((cell) => [cell.column, cell.value]) ?? []);
    const headerLine = header ? `Columns: ${header.cells.map((c) => c.value).join(' | ')}` : '';

    const lines = rows
      .filter((row) => row !== header)
      .map((row) => {
        const cells = row.cells.map((cell) => {
          const label = labels.get(cell.column);
          return label ? `${label}=${cell.value}` : `${cell.column}=${cell.value}`;
        });
        return `Row ${row.number}: ${cells.join(' | ')}`;
      });

    const rowNumbers = rows.filter((row) => row !== header).map((row) => row.number);
    for (const packed of packLines(lines)) {
      const first = rowNumbers[packed.firstLine];
      const last = rowNumbers[packed.lastLine];
      const context = [`[Sheet: ${sheet.name}]`, headerLine].filter(Boolean).join('\n');
      chunks.push({
        page: null,
        location: `${sheet.name}!rows ${first}–${last}`,
        text: `${context}\n${packed.text}`,
      });
    }
  }

  return {
    format: 'xlsx',
    chunks,
    truncated: truncated || undefined,
    note: truncated
      ? `Only the first ${MAX_ROWS_PER_SHEET} rows of each sheet were indexed.`
      : chunks.length
        ? undefined
        : 'The workbook contains no extractable cell text (it may hold only charts or images).',
  };
}
