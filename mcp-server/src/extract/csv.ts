import { readFileSync } from 'node:fs';
import { packLines } from './chunk';
import type { ExtractionResult, TextChunk } from './types';

/** Same bound as the Excel extractor, so a huge export cannot exhaust memory. */
const MAX_ROWS = 20_000;
const MAX_CELL_CHARS = 500;
const DELIMITERS = [';', ',', '\t', '|'] as const;

/**
 * Danish exports from Excel are usually Windows-1252 rather than UTF-8; a
 * strict UTF-8 decode that fails is the signal to fall back.
 */
function decode(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.replace(/^\uFEFF/, '');
}

/** Split one physical-or-logical CSV record stream into rows, honouring double-quoted fields. */
export function parseCsv(text: string, delimiter: string, maxRows: number = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length && rows.length < maxRows; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if ((field || row.length) && rows.length < maxRows) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Pick the delimiter that splits the first lines into the same, largest
 * number of columns. Semicolon wins ties because Danish locale exports use it
 * (the comma is the decimal separator there).
 */
export function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 20_000);
  let best: string = DELIMITERS[0];
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const rows = parseCsv(sample, delimiter, 20).filter((row) => row.some((cell) => cell.trim()));
    if (!rows.length) continue;
    const widths = rows.map((row) => row.length);
    const consistent = widths.filter((width) => width === widths[0]).length / widths.length;
    const score = widths[0] > 1 ? widths[0] * consistent : 0;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function looksNumeric(value: string): boolean {
  return /^[-+]?[\d.,\s]+$/.test(value) && /\d/.test(value);
}

export function extractCsv(filePath: string): ExtractionResult {
  const text = decode(readFileSync(filePath));
  const delimiter = sniffDelimiter(text);
  const parsed = parseCsv(text, delimiter, MAX_ROWS + 1);
  const truncated = parsed.length > MAX_ROWS;

  const rows = parsed.slice(0, MAX_ROWS)
    .map((cells, index) => ({
      number: index + 1,
      cells: cells.map((cell) => {
        const value = cell.replace(/\s+/g, ' ').trim();
        return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value;
      }),
    }))
    .filter((row) => row.cells.some(Boolean));

  const header = rows
    .slice(0, 10)
    .find((row) => row.cells.filter(Boolean).length >= 2 && row.cells.every((cell) => !cell || !looksNumeric(cell)));
  const dataRows = rows.filter((row) => row !== header);
  const headerLine = header ? `Columns: ${header.cells.filter(Boolean).join(' | ')}` : '';

  const lines = dataRows.map((row) => {
    const cells = row.cells.flatMap((value, column) => {
      if (!value) return [];
      const label = header?.cells[column] || `col${column + 1}`;
      return [`${label}=${value}`];
    });
    return `Row ${row.number}: ${cells.join(' | ')}`;
  });

  const chunks: TextChunk[] = packLines(lines).map((packed) => ({
    page: null,
    location: `rows ${dataRows[packed.firstLine].number}–${dataRows[packed.lastLine].number}`,
    text: [headerLine, packed.text].filter(Boolean).join('\n'),
  }));

  return {
    format: 'csv',
    chunks,
    truncated: truncated || undefined,
    note: truncated
      ? `Only the first ${MAX_ROWS} rows were indexed.`
      : chunks.length
        ? undefined
        : 'The CSV file contains no cell text.',
  };
}
