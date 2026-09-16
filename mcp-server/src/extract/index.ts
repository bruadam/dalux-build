import path from 'node:path';
import { extractDocx } from './docx';
import { extractPdf } from './pdf';
import { extractXlsx } from './xlsx';
import { UnsupportedFormatError, type DocumentFormat, type ExtractionResult } from './types';

export * from './types';
export { CHUNK_SIZE, CHUNK_OVERLAP } from './chunk';

/** Extensions this server can read, in the form the tool descriptions advertise. */
export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.docm', '.xlsx', '.xlsm'] as const;

const FORMAT_BY_EXTENSION: Record<string, DocumentFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  // Macro-enabled variants are the same OOXML container with a different
  // content type; the parts holding the text are identical.
  '.docm': 'docx',
  '.xlsx': 'xlsx',
  '.xlsm': 'xlsx',
};

export function formatFor(fileName: string): DocumentFormat | null {
  return FORMAT_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? null;
}

export function isSupported(fileName: string): boolean {
  return formatFor(fileName) !== null;
}

/**
 * Extract searchable chunks from a local file.
 *
 * `nameHint` is used for format detection when the cached path lost the
 * original extension; it falls back to the path itself.
 */
export async function extractDocument(filePath: string, nameHint?: string): Promise<ExtractionResult> {
  const format = formatFor(nameHint ?? filePath) ?? formatFor(filePath);
  if (!format) {
    throw new UnsupportedFormatError(
      path.extname(nameHint ?? filePath).toLowerCase(),
      SUPPORTED_EXTENSIONS,
    );
  }
  switch (format) {
    case 'pdf':
      return extractPdf(filePath);
    case 'docx':
      return extractDocx(filePath);
    case 'xlsx':
      return extractXlsx(filePath);
  }
}
