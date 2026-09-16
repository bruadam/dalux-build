/**
 * Text extraction for HTML (.html/.htm).
 *
 * Regex-based tag stripping rather than a DOM parser — this server already
 * takes the same approach for Office XML (see extract/ooxml.ts), and a
 * reference document exported to HTML doesn't need a layout engine, only its
 * text and heading structure. `<script>`/`<style>` contents are dropped
 * before stripping so their code/CSS never leaks into search results; `h1`-
 * `h6` are tracked the same way extract/docx.ts tracks Word heading styles, so
 * a passage cites the section it came from.
 */

import { readFileSync } from 'node:fs';
import { decodeXmlEntities } from './ooxml';
import { packLines } from './chunk';
import type { ExtractionResult, TextChunk } from './types';

/** Beyond the five XML entities decodeXmlEntities already knows, HTML documents commonly carry these. */
const EXTRA_HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
  sect: '§',
  para: '¶',
  middot: '·',
  deg: '°',
};

function decodeHtmlEntities(text: string): string {
  const withExtras = text.replace(/&([a-zA-Z]+);/g, (match, name: string) => EXTRA_HTML_ENTITIES[name] ?? match);
  return decodeXmlEntities(withExtras);
}

/** Strips a tag's own markup, leaving its text content (and inline child tags) behind. */
function stripTag(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

interface Line {
  text: string;
  heading: string;
}

const BLOCK_TOKEN = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<(p|li|tr|td|th|div|br|blockquote)\b[^>]*\/?>|<\/(p|li|tr|td|th|div|blockquote)>/gi;

function linesFromHtml(html: string): Line[] {
  // Whole-element removal, not just their tags — the point is to never surface
  // script/style content as if it were prose.
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  const headings: string[] = [];
  const headingPath = () => headings.filter(Boolean).join(' › ');

  const lines: Line[] = [];
  let buffer = '';
  let lastIndex = 0;

  const flush = () => {
    const text = decodeHtmlEntities(stripTag(buffer)).replace(/\s+/g, ' ').trim();
    buffer = '';
    if (text) lines.push({ text, heading: headingPath() });
  };

  for (const match of withoutNoise.matchAll(BLOCK_TOKEN)) {
    buffer += withoutNoise.slice(lastIndex, match.index);
    lastIndex = (match.index ?? 0) + match[0].length;

    const headingTag = match[1];
    if (headingTag) {
      flush();
      const level = Number(headingTag[1]);
      const text = decodeHtmlEntities(stripTag(match[2])).replace(/\s+/g, ' ').trim();
      headings.length = Math.min(headings.length, level - 1);
      headings[level - 1] = text;
      // The heading's own words are pushed as a line too (heading self-referencing
      // its own path), same as extract/docx.ts — otherwise a search for the
      // heading's exact title would never match anything.
      if (text) lines.push({ text, heading: headingPath() });
      continue;
    }

    flush();
  }
  buffer += withoutNoise.slice(lastIndex);
  flush();

  return lines;
}

export function extractHtml(filePath: string): ExtractionResult {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = linesFromHtml(raw);

  const chunks: TextChunk[] = packLines(lines.map((line) => line.text)).map((packed) => {
    const heading = lines[packed.firstLine]?.heading;
    return {
      page: null,
      location: heading ? `§ ${heading}` : `¶ ${packed.firstLine + 1}–${packed.lastLine + 1}`,
      text: packed.text,
    };
  });

  return {
    format: 'html',
    chunks,
    note: chunks.length ? undefined : 'The file contains no extractable text.',
  };
}
