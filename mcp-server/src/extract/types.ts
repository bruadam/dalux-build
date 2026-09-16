/** Formats whose text this server can extract and search. */
export type DocumentFormat = 'pdf' | 'docx' | 'xlsx';

export interface TextChunk {
  /** 1-based page number for PDFs; null for formats that have no pages. */
  page: number | null;
  /** Human-readable citation anchor, e.g. "p. 12", "Budget!rows 40-58", "§ 4.2 Payment". */
  location: string;
  text: string;
}

export interface ExtractionResult {
  format: DocumentFormat;
  chunks: TextChunk[];
  /** PDF only: total page count and the 1-based pages that carried no text layer. */
  pageCount?: number;
  pagesWithoutText?: number[];
  /** True when extraction stopped early to bound memory (very large spreadsheets). */
  truncated?: boolean;
  /** Caveat worth showing the agent verbatim, e.g. "scanned drawing, no text layer". */
  note?: string;
}

/**
 * Thrown for files this server knows it cannot read (.doc, .dwg, .rvt, images…).
 * Callers treat it as "skip and report", never as a hard failure — a file area
 * full of CAD files should still index its specifications.
 */
export class UnsupportedFormatError extends Error {
  readonly extension: string;

  constructor(extension: string, supported: readonly string[]) {
    super(
      `Cannot extract text from "${extension || 'file with no extension'}". ` +
        `Supported formats: ${supported.join(', ')}.`,
    );
    this.name = 'UnsupportedFormatError';
    this.extension = extension;
  }
}
