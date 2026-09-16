/**
 * Text extraction for Word documents (.docx / .docm).
 *
 * Emits one line per paragraph and one line per table row (cells joined with
 * " | "), then packs those lines into chunks. Headings are tracked as the
 * chunks go by so each passage can cite the clause it came from — "§ 4.2
 * Payment" is a far more useful citation for a contract than a character offset.
 */

import { attr, collectTextElements, decodeXmlEntities, entryText, readOoxmlEntries } from './ooxml';
import { packLines } from './chunk';
import type { ExtractionResult, TextChunk } from './types';

/**
 * Heading style IDs. Word writes the *template's* style ID, which is localised
 * in non-English Office installs — Danish "Overskrift1", German "berschrift1"
 * (the umlaut is escaped out of the ID), etc. Dalux projects are routinely
 * Nordic, so matching English-only would silently lose every heading.
 */
const HEADING_STYLE = /^(?:heading|overskrift|überschrift|berschrift|rubrik|otsikko|titre|kop|kopf)\s*-?\s*(\d)$/i;

interface Line {
  text: string;
  /** Heading path in effect at this line, e.g. "4 Payment › 4.2 Retention". */
  heading: string;
}

function paragraphText(paragraphXml: string): string {
  // <w:tab/> and <w:br/> carry layout meaning that matters for readability;
  // deleted text lives in <w:delText> and is intentionally not collected.
  const spaced = paragraphXml.replace(/<w:(?:tab|br|cr)\s*\/>/g, ' ');
  return collectTextElements(spaced, 'w:t').replace(/\s+/g, ' ').trim();
}

function headingLevel(paragraphXml: string): number | null {
  const style = paragraphXml.match(/<w:pStyle\s[^>]*w:val="([^"]*)"/);
  if (style) {
    const match = decodeXmlEntities(style[1]).match(HEADING_STYLE);
    if (match) return Number(match[1]);
  }
  const outline = paragraphXml.match(/<w:outlineLvl\s[^>]*w:val="(\d+)"/);
  if (outline) return Number(outline[1]) + 1;
  return null;
}

/** Walk a document body, emitting paragraphs and table rows in reading order. */
function linesFromBody(xml: string): Line[] {
  const token =
    /<w:tbl\b[^>]*>|<\/w:tbl>|<\/w:tr>|<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;

  const lines: Line[] = [];
  const headings: string[] = [];
  let tableDepth = 0;
  let row: string[] = [];

  const headingPath = () => headings.filter(Boolean).join(' › ');

  const flushRow = () => {
    if (row.length) {
      lines.push({ text: row.join(' | '), heading: headingPath() });
      row = [];
    }
  };

  for (const match of xml.matchAll(token)) {
    const [tag, body] = match;

    if (tag.startsWith('<w:tbl')) {
      tableDepth += 1;
      continue;
    }
    if (tag === '</w:tbl>') {
      flushRow();
      tableDepth = Math.max(0, tableDepth - 1);
      continue;
    }
    if (tag === '</w:tr>') {
      flushRow();
      continue;
    }

    const text = body ? paragraphText(body) : '';
    if (!text) continue;

    if (tableDepth > 0) {
      row.push(text);
      continue;
    }

    const level = body ? headingLevel(body) : null;
    if (level !== null) {
      headings.length = Math.min(headings.length, level - 1);
      headings[level - 1] = text;
    }
    lines.push({ text, heading: headingPath() });
  }

  flushRow();
  return lines;
}

export function extractDocx(filePath: string): ExtractionResult {
  const entries = readOoxmlEntries(filePath);
  const documentXml = entryText(entries, 'word/document.xml');
  if (documentXml === null) {
    throw new Error('Not a Word document: word/document.xml is missing from the archive.');
  }

  const body = documentXml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  const lines = linesFromBody(body ? body[1] : documentXml);

  // Footnotes and endnotes carry real contractual content; headers/footers are
  // page furniture repeated on every page and are deliberately skipped.
  for (const part of ['word/footnotes.xml', 'word/endnotes.xml']) {
    const xml = entryText(entries, part);
    if (!xml) continue;
    const label = part.includes('foot') ? 'Footnotes' : 'Endnotes';
    for (const line of linesFromBody(xml)) {
      lines.push({ text: line.text, heading: label });
    }
  }

  const chunks: TextChunk[] = packLines(lines.map((line) => line.text)).map((packed) => {
    const heading = lines[packed.firstLine]?.heading;
    return {
      page: null,
      location: heading
        ? `§ ${heading}`
        : `¶ ${packed.firstLine + 1}–${packed.lastLine + 1}`,
      text: packed.text,
    };
  });

  return {
    format: 'docx',
    chunks,
    note: chunks.length
      ? undefined
      : 'The document contains no extractable text (it may hold only images or embedded objects).',
  };
}
