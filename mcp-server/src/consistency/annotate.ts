/**
 * Annotated-PDF export: every finding's quote is highlighted in the PDF it
 * came from, with a comment that names the conflicting value in the other
 * document(s). Quotes are located in the pdfjs text content of the same
 * pdfjs that extracted them (pdf-parse's bundled copy, see openPdf) and the
 * annotations are written with pdf-lib as an incremental update, so the
 * original bytes stay untouched in front.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFPage,
  type PDFRef,
} from '@cantoo/pdf-lib';
import type { DaluxClient } from 'dalux-build-api';
import { PDFParse } from 'pdf-parse';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { consistencyReportDir } from '../cachePaths';
import { downloadSource } from '../rag/build';
import { listIndexableFiles } from '../rag/scope';
import type { Finding, Severity, Statement } from './compare';
import { toXlsx } from './export';
import type { ReportManifest } from './report';

const AUTHOR = 'Dalux MCP';

const COLORS: Record<Severity, [number, number, number]> = {
  high: [1, 0.35, 0.35],
  medium: [1, 0.65, 0.2],
  low: [1, 0.95, 0.3],
};

// ---------- locating quotes ----------

export interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface CharRef {
  item: number;
  index: number;
}

/** Lowercased, NFKC (ligatures), no whitespace or soft hyphens — compared on both sides. */
function squashChar(char: string): string {
  return char.normalize('NFKC').toLowerCase().replace(/[\s\u00ad]/g, '');
}

/** A hyphen between letters: line-break hyphenation ("Defi-nitioner") or a compound; dropped on both sides. */
const WORD_HYPHEN = /(?<=\p{L})-(?=\p{L})/gu;

export function squash(text: string): string {
  return [...text.replace(/…$/, '')].map(squashChar).join('').replace(WORD_HYPHEN, '');
}

/** The page's text in squashed form, with each character's source item. */
function pageIndex(items: readonly TextItem[]): { text: string; refs: CharRef[] } {
  let raw = '';
  const rawRefs: CharRef[] = [];
  items.forEach((item, k) => {
    [...item.str].forEach((char, index) => {
      for (const squashed of squashChar(char)) {
        raw += squashed;
        rawRefs.push({ item: k, index });
      }
    });
  });
  const dropped = new Set([...raw.matchAll(WORD_HYPHEN)].map((match) => match.index));
  const refs = rawRefs.filter((_, i) => !dropped.has(i));
  return { text: raw.replace(WORD_HYPHEN, ''), refs };
}

function findRange(text: string, needle: string): [number, number] | null {
  if (!needle) return null;
  const at = text.indexOf(needle);
  if (at >= 0) return [at, at + needle.length];
  // The quote's start and end are on the page in order, about the right distance apart.
  const anchor = Math.min(24, Math.floor(needle.length / 3));
  if (anchor < 6) return null;
  const head = needle.slice(0, anchor);
  const tail = needle.slice(-anchor);
  for (let start = text.indexOf(head); start >= 0; start = text.indexOf(head, start + 1)) {
    const end = text.indexOf(tail, start + anchor);
    if (end < 0) break;
    const length = end + anchor - start;
    if (length >= needle.length * 0.7 && length <= needle.length * 1.4) return [start, end + anchor];
  }
  return null;
}

/**
 * Table cells and multi-column text come out of the extractor in a different
 * order than pdfjs lists them, so a quote may only exist in pieces: accept it
 * when runs of four words covering most of it are on the page.
 */
function findPieces(text: string, quote: string): [number, number][] | null {
  const words = quote.replace(/…$/, '').split(/\s+/).filter(Boolean);
  const ranges: [number, number][] = [];
  let covered = 0;
  for (let i = 0; i < words.length; i += 4) {
    const piece = squash(words.slice(i, i + 4).join(' '));
    if (piece.length < 8) continue;
    const range = findRange(text, piece);
    if (range && text.indexOf(piece, range[0] + 1) < 0) {
      ranges.push(range);
      covered += piece.length;
    }
  }
  return covered >= squash(quote).length * 0.6 ? ranges : null;
}

/**
 * QuadPoints (Acrobat order: top-left, top-right, bottom-left, bottom-right
 * per line) covering `quote` on a page, or null when it is not there.
 */
export function locateQuote(items: readonly TextItem[], quote: string): number[] | null {
  const { text, refs } = pageIndex(items);
  const exact = findRange(text, squash(quote));
  const ranges = exact ? [exact] : findPieces(text, quote);
  if (!ranges?.length) return null;

  // Character span per item, then items merged into lines.
  const spans = new Map<number, [number, number]>();
  for (const ref of ranges.flatMap(([from, to]) => refs.slice(from, to))) {
    const span = spans.get(ref.item);
    spans.set(ref.item, span ? [Math.min(span[0], ref.index), Math.max(span[1], ref.index + 1)] : [ref.index, ref.index + 1]);
  }

  interface Line { dir: [number, number]; baseline: number; start: number; end: number; height: number }
  const lines: Line[] = [];
  for (const [k, [from, to]] of spans) {
    const item = items[k];
    const [a, b, c, d, e, f] = item.transform;
    const scale = Math.hypot(a, b) || 1;
    const dir: [number, number] = [a / scale, b / scale];
    const height = item.height || Math.hypot(c, d);
    const advance = item.width / Math.max(1, [...item.str].length);
    const along = e * dir[0] + f * dir[1];
    const baseline = -e * dir[1] + f * dir[0];
    const start = along + from * advance;
    const end = along + to * advance;
    const line = lines.find(
      (l) => Math.abs(l.dir[0] - dir[0]) < 0.01 && Math.abs(l.dir[1] - dir[1]) < 0.01 && Math.abs(l.baseline - baseline) < height / 2,
    );
    if (line) {
      line.start = Math.min(line.start, start);
      line.end = Math.max(line.end, end);
      line.height = Math.max(line.height, height);
    } else {
      lines.push({ dir, baseline, start, end, height });
    }
  }

  return lines.flatMap(({ dir, baseline, start, end, height }) => {
    const point = (s: number, t: number) => [s * dir[0] - t * dir[1], s * dir[1] + t * dir[0]];
    const top = baseline + height * 0.9;
    const bottom = baseline - height * 0.25;
    return [...point(start, top), ...point(end, top), ...point(start, bottom), ...point(end, bottom)];
  });
}

// ---------- comment text ----------

export type Language = 'da' | 'en';

export function detectLanguage(text: string): Language {
  const count = (words: string[]) =>
    words.reduce((sum, word) => sum + (text.match(new RegExp(`(^|[^\\p{L}])${word}(?=$|[^\\p{L}])`, 'giu'))?.length ?? 0), 0);
  const danish = count(['og', 'af', 'til', 'med', 'skal', 'der', 'ikke', 'som', 'den', 'det', 'er', 'på', 'for']);
  const english = count(['and', 'of', 'to', 'with', 'shall', 'the', 'not', 'as', 'is', 'on', 'for']);
  return danish > english ? 'da' : 'en';
}

const DANISH_ATTRIBUTES: Record<string, string> = {
  fire_class: 'brandklasse',
  concrete_class: 'betonklasse',
  exposure_class: 'eksponeringsklasse',
  u_value: 'U-værdi',
  sound_insulation: 'lydisolation',
  impact_sound: 'trinlyd',
  width: 'bredde',
  height: 'højde',
  thickness: 'tykkelse',
  length: 'længde',
  depth: 'dybde',
  diameter: 'diameter',
  quantity: 'mængde',
  amount: 'beløb',
  unit_price: 'enhedspris',
  contract_sum: 'kontraktsum',
  handover_date: 'afleveringsdato',
  start_date: 'startdato',
  completion_date: 'færdigdato',
  tender_deadline: 'tilbudsfrist',
  date: 'dato',
  edition: 'udgave',
  national_annex: 'nationalt anneks',
  revision: 'revision',
};

const SEVERITY_DA: Record<Severity, string> = { high: 'høj', medium: 'middel', low: 'lav' };

/** "Døre!row 14" → "ark 'Døre', række 14"; "p. 3" → "s. 3". */
function describeLocation(location: string, language: Language): string {
  const sheet = location.match(/^(.*)!(.*)$/);
  const rest = (sheet ? sheet[2] : location)
    .replace(/\brows? (\d+)/g, (_, n: string) => (language === 'da' ? `række ${n}` : `row ${n}`))
    .replace(/\bp\. ?(\d+)/g, (_, n: string) => (language === 'da' ? `s. ${n}` : `p. ${n}`));
  if (!sheet) return rest;
  return `${language === 'da' ? 'ark' : 'sheet'} '${sheet[1]}', ${rest}`;
}

export function commentFor(finding: Finding, statement: Statement, language: Language): string {
  const da = language === 'da';
  const attribute = da ? DANISH_ATTRIBUTES[finding.attribute] ?? finding.attribute.replace(/_/g, ' ') : finding.attribute.replace(/_/g, ' ');
  const subject = da && finding.subject === 'project' ? 'projekt' : finding.subject;
  const others = finding.statements
    .filter((other) => other !== statement && other.value !== statement.value)
    .map((other) => {
      const file = other.fileId === statement.fileId ? (da ? 'dette dokument' : 'this document') : other.fileName;
      return `${file}${other.location ? `, ${describeLocation(other.location, language)}` : ''}: ${other.value ?? other.quote}`;
    });
  return [
    `${da ? 'Uoverensstemmelse' : 'Inconsistency'} (${da ? SEVERITY_DA[finding.severity] : finding.severity}, ${finding.type}): ${subject} ${attribute}.`,
    `${da ? 'Dette dokument' : 'This document'}: ${statement.value ?? statement.quote}.`,
    others.length ? `${da ? 'Modstrid med' : 'Conflicts with'} ${others.join('; ')}.` : null,
    finding.explanation ?? null,
    finding.precedenceNote ?? null,
    `[finding ${finding.id}]`,
  ]
    .filter(Boolean)
    .join(' ');
}

// ---------- writing annotations ----------

/**
 * The pdfjs document pdf-parse itself parses for extractPdf. Its `load()` is
 * private in the typings but is what `getText()` runs on; using it means the
 * text items are the ones the quotes were cut from, and it avoids loading the
 * ESM-only pdfjs-dist build, which Jest cannot require on Node < 24.9 (see
 * extract/rasterize.ts).
 */
async function openPdf(data: Uint8Array): Promise<{ doc: PDFDocumentProxy; close: () => Promise<void> }> {
  const parser = new PDFParse({ data });
  try {
    const doc = await (parser as unknown as { load(): Promise<PDFDocumentProxy> }).load();
    return { doc, close: () => parser.destroy() };
  } catch (err) {
    await parser.destroy();
    throw err;
  }
}

export interface AnnotationTarget {
  finding: Finding;
  statement: Statement;
}

export interface Placement {
  findingId: string;
  page: number;
  /** false: the quote was not found and a page-level note was placed instead. */
  matched: boolean;
}

function pageOf(location: string): number | null {
  const match = location.match(/\bp\. ?(\d+)/);
  return match ? Number(match[1]) : null;
}

function bounds(quads: number[]): [number, number, number, number] {
  const xs = quads.filter((_, i) => i % 2 === 0);
  const ys = quads.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString();
}

function addAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  options: { subtype: 'Highlight' | 'Text'; rect: number[]; quads?: number[]; color: number[]; contents: string; name: string; appearance: string; bbox: number[] },
): void {
  const { context } = doc;
  const appearance = context.register(
    context.stream(options.appearance, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: options.bbox,
      Resources: { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply' } } },
    }),
  );
  const annotation = context.obj({
    Type: 'Annot',
    Subtype: options.subtype,
    Rect: options.rect,
    C: options.color,
    // Print, plus NoZoom/NoRotate for the note icon.
    F: options.subtype === 'Text' ? 28 : 4,
    AP: { N: appearance },
    ...(options.quads ? { QuadPoints: options.quads } : { Name: 'Comment' }),
  });
  annotation.set(PDFName.of('Contents'), PDFHexString.fromText(options.contents));
  annotation.set(PDFName.of('T'), PDFHexString.fromText(AUTHOR));
  annotation.set(PDFName.of('NM'), PDFHexString.fromText(options.name));
  annotation.set(PDFName.of('M'), PDFString.fromDate(new Date()));
  annotation.set(PDFName.of('P'), page.ref);
  const annotationRef: PDFRef = context.register(annotation);

  const [, , x2, y2] = options.rect;
  const popup = context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [x2, y2 - 120, x2 + 240, y2], Open: false, F: 28 });
  popup.set(PDFName.of('Parent'), annotationRef);
  const popupRef = context.register(popup);
  annotation.set(PDFName.of('Popup'), popupRef);

  page.node.addAnnot(annotationRef);
  page.node.addAnnot(popupRef);
}

/**
 * Highlight each target's quote in `pdf` with a comment; quotes that cannot be
 * found on their page or its neighbours get a note at the top of the page.
 * Throws for PDFs that cannot be annotated (encrypted, unreadable).
 */
export async function annotatePdf(
  pdf: Uint8Array,
  targets: readonly AnnotationTarget[],
): Promise<{ pdf: Uint8Array; placements: Placement[]; language: Language }> {
  const doc = await PDFDocument.load(pdf, { forIncrementalUpdate: true, updateMetadata: false });
  const pages = doc.getPages();

  const { doc: source, close } = await openPdf(pdf.slice());
  try {
    const itemsCache = new Map<number, TextItem[]>();
    const itemsOf = async (n: number) => {
      if (!itemsCache.has(n)) {
        const content = await (await source.getPage(n)).getTextContent();
        itemsCache.set(n, content.items.filter((item): item is TextItem & typeof item => 'str' in item));
      }
      return itemsCache.get(n)!;
    };

    const sample: string[] = [];
    for (let n = 1; n <= Math.min(source.numPages, 5); n++) sample.push((await itemsOf(n)).map((item) => item.str).join(' '));
    const language = detectLanguage(sample.join(' '));

    const placements: Placement[] = [];
    const names = new Map<string, number>();
    const uniqueName = (page: number, id: string) => {
      const key = `${page}:${id}`;
      const seen = (names.get(key) ?? 0) + 1;
      names.set(key, seen);
      return seen === 1 ? id : `${id}-${seen}`;
    };

    for (const { finding, statement } of targets) {
      const expected = Math.min(Math.max(pageOf(statement.location) ?? 1, 1), source.numPages);
      const candidates = pageOf(statement.location)
        ? [expected, expected - 1, expected + 1].filter((n) => n >= 1 && n <= source.numPages)
        : Array.from({ length: source.numPages }, (_, i) => i + 1);
      let found: { page: number; quads: number[] } | null = null;
      for (const n of candidates) {
        const quads = locateQuote(await itemsOf(n), statement.quote);
        if (quads?.length) {
          found = { page: n, quads };
          break;
        }
      }

      const color = COLORS[finding.severity];
      const comment = commentFor(finding, statement, language);
      if (found) {
        const rect = bounds(found.quads);
        const shapes: string[] = [];
        for (let i = 0; i < found.quads.length; i += 8) {
          const [x1, y1, x2, y2, x3, y3, x4, y4] = found.quads.slice(i, i + 8).map(fmt);
          shapes.push(`${x1} ${y1} m ${x2} ${y2} l ${x4} ${y4} l ${x3} ${y3} l h f`);
        }
        addAnnotation(doc, pages[found.page - 1], {
          subtype: 'Highlight',
          rect,
          quads: found.quads,
          color,
          contents: comment,
          name: uniqueName(found.page, finding.id),
          appearance: `/GS0 gs ${color.join(' ')} rg ${shapes.join(' ')}`,
          bbox: rect,
        });
        placements.push({ findingId: finding.id, page: found.page, matched: true });
      } else {
        // Top-left of the page as displayed (crop box and /Rotate applied).
        const viewport = (await source.getPage(expected)).getViewport({ scale: 1 });
        const [x, y] = viewport.convertToPdfPoint(24, 24);
        const prefix = language === 'da' ? 'Citatet blev ikke fundet på siden' : 'Quote not found on this page';
        addAnnotation(doc, pages[expected - 1], {
          subtype: 'Text',
          rect: [x, y - 20, x + 20, y],
          color,
          contents: `${prefix}: "${statement.quote}". ${comment}`,
          name: uniqueName(expected, finding.id),
          appearance: `${color.join(' ')} rg 0 0 0 RG 1 w 0.5 0.5 19 19 re B 0 g 4 13 m 16 13 l 4 9 m 13 9 l S`,
          bbox: [0, 0, 20, 20],
        });
        placements.push({ findingId: finding.id, page: expected, matched: false });
      }
    }

    return { pdf: await doc.commit(), placements, language };
  } finally {
    await close();
  }
}

// ---------- export ----------

export interface AnnotatedExport {
  fileName: string;
  filePath: string;
  annotatedFiles: number;
  unmatchedQuotes: number;
}

function zipEntryName(fileName: string, taken: Set<string>): string {
  const base = `${path.basename(fileName.replace(/\\/g, '/'))}.annotated.pdf`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = base.replace(/\.annotated\.pdf$/, ` (${n}).annotated.pdf`);
  taken.add(name);
  return name;
}

/** Download each PDF with findings, annotate it, and zip the copies with the xlsx register. Never uploads. */
export async function writeAnnotatedExport(client: DaluxClient, manifest: ReportManifest, findings: readonly Finding[]): Promise<AnnotatedExport> {
  const byFile = new Map<string, AnnotationTarget[]>();
  for (const finding of findings) {
    for (const statement of finding.statements) {
      if (!statement.fileName.toLowerCase().endsWith('.pdf')) continue;
      byFile.set(statement.fileId, [...(byFile.get(statement.fileId) ?? []), { finding, statement }]);
    }
  }

  const dir = path.join(consistencyReportDir(manifest.reportId), 'exports');
  const downloads = path.join(consistencyReportDir(manifest.reportId), 'annotate-src');
  mkdirSync(dir, { recursive: true });
  mkdirSync(downloads, { recursive: true });

  const entries: Record<string, Uint8Array> = {};
  const taken = new Set<string>();
  const notes: string[][] = [];
  let annotatedFiles = 0;
  let unmatchedQuotes = 0;

  const listed = byFile.size ? await listIndexableFiles(client, manifest.scope) : { files: [] };
  try {
    for (const [fileId, targets] of byFile) {
      const { fileName, revisionId } = targets[0].statement;
      const note = (finding: string, page: string, result: string) => notes.push([finding, fileName, page, result]);
      const file = listed.files.find((candidate) => candidate.fileId === fileId);
      if (!file) {
        note('', '', 'Not annotated: the file is no longer in the file area/folder.');
        continue;
      }
      if (revisionId && file.revisionKey !== revisionId) {
        note('', '', 'The file has a newer revision than the analysed one; quotes may not be found.');
      }
      let localPath: string | null = null;
      try {
        localPath = await downloadSource(client, manifest.scope, downloads, file);
        const result = await annotatePdf(new Uint8Array(readFileSync(localPath)), targets);
        entries[zipEntryName(fileName, taken)] = result.pdf;
        annotatedFiles += 1;
        for (const placement of result.placements) {
          if (!placement.matched) unmatchedQuotes += 1;
          note(
            placement.findingId,
            String(placement.page),
            placement.matched ? 'Highlighted' : 'Quote not found — note placed at the top of the page',
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        note('', '', `Not annotated: ${/encrypt|password/i.test(message) ? 'the PDF is encrypted or password-protected' : message}`);
      } finally {
        if (localPath) rmSync(localPath, { force: true });
      }
    }
  } finally {
    rmSync(downloads, { recursive: true, force: true });
  }

  entries[`consistency-report-${manifest.reportId}.xlsx`] = toXlsx(findings, notes);
  const fileName = `consistency-report-${manifest.reportId}.annotated-pdf.zip`;
  const filePath = path.join(dir, fileName);
  writeFileSync(filePath, zipSync(entries));
  return { fileName, filePath, annotatedFiles, unmatchedQuotes };
}
