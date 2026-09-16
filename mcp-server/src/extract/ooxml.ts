/**
 * Minimal Office Open XML reader.
 *
 * .docx/.xlsx are zip archives of XML parts. Text extraction for search needs
 * none of the formatting model a full parser (mammoth, exceljs) builds, so this
 * unzips with fflate and pulls text out of the handful of parts that carry it.
 * That keeps the dependency surface of a deployed server to one 30 KB library.
 */

import { readFileSync, statSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';

/** Refuse archives large enough to be a memory problem — fflate inflates in full. */
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

export type OoxmlEntries = Record<string, Uint8Array>;

export function readOoxmlEntries(filePath: string): OoxmlEntries {
  const { size } = statSync(filePath);
  if (size > MAX_ARCHIVE_BYTES) {
    throw new Error(
      `File is ${(size / 1024 / 1024).toFixed(0)} MB, above the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB limit for in-memory Office parsing.`,
    );
  }
  let entries: OoxmlEntries;
  try {
    entries = unzipSync(readFileSync(filePath));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Not a readable Office file (could not unzip): ${message}. ` +
        'Legacy .doc/.xls files use a different container and are not supported.',
    );
  }
  return entries;
}

export function entryText(entries: OoxmlEntries, name: string): string | null {
  const data = entries[name];
  return data ? strFromU8(data) : null;
}

/** Entry names matching a pattern, in stable order (e.g. every worksheet part). */
export function entryNames(entries: OoxmlEntries, pattern: RegExp): string[] {
  return Object.keys(entries).filter((name) => pattern.test(name)).sort();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(parseInt(entity.slice(1), 10));
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

/** Concatenate the text of every `<w:t>`/`<a:t>`/`<t>` element inside `xml`. */
export function collectTextElements(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let out = '';
  for (const match of xml.matchAll(pattern)) {
    out += decodeXmlEntities(match[1]);
  }
  return out;
}

/** Value of an attribute on an element's opening tag, e.g. `r="B4"`. */
export function attr(openingTag: string, name: string): string | null {
  const match = openingTag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeXmlEntities(match[1]) : null;
}
