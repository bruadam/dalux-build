/**
 * Text extraction for Markdown (.md/.markdown).
 *
 * Markdown is already plain text, so there is nothing to unzip or parse out of
 * a container — the only real work is tracking ATX headings (`#`..`######`) as
 * the file is read, the same "§ 4.2 Payment"-style citation approach as
 * extract/docx.ts, so a passage can point back at the section it came from
 * rather than a raw line number when a heading is available.
 */

import { readFileSync } from 'node:fs';
import { packLines } from './chunk';
import type { ExtractionResult, TextChunk } from './types';

interface Line {
  text: string;
  /** Heading path in effect at this line, e.g. "1 Duty holders › 1.2 Accountable person". */
  heading: string;
}

const ATX_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
/** Fenced code blocks (```/~~~) are kept verbatim rather than treated as headings/prose. */
const FENCE = /^(```|~~~)/;

function linesFromMarkdown(raw: string): Line[] {
  const headings: string[] = [];
  const headingPath = () => headings.filter(Boolean).join(' › ');

  const lines: Line[] = [];
  let inFence = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    if (FENCE.test(rawLine.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      const text = rawLine.trim();
      if (text) lines.push({ text, heading: headingPath() });
      continue;
    }

    const heading = ATX_HEADING.exec(rawLine);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      headings.length = Math.min(headings.length, level - 1);
      headings[level - 1] = text;
      // The heading's own words are pushed as a line too (heading self-referencing
      // its own path), same as extract/docx.ts — otherwise a search for the
      // heading's exact title would never match anything.
      if (text) lines.push({ text, heading: headingPath() });
      continue;
    }

    const text = rawLine.trim();
    if (!text) continue;
    lines.push({ text, heading: headingPath() });
  }
  return lines;
}

export function extractMarkdown(filePath: string): ExtractionResult {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = linesFromMarkdown(raw);

  const chunks: TextChunk[] = packLines(lines.map((line) => line.text)).map((packed) => {
    const heading = lines[packed.firstLine]?.heading;
    return {
      page: null,
      location: heading ? `§ ${heading}` : `¶ ${packed.firstLine + 1}–${packed.lastLine + 1}`,
      text: packed.text,
    };
  });

  return {
    format: 'md',
    chunks,
    note: chunks.length ? undefined : 'The file contains no extractable text.',
  };
}
