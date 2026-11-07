import { mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDict, PDFDocument, PDFHexString, PDFName } from '@cantoo/pdf-lib';
import type { DaluxClient } from 'dalux-build-api';

import { annotatePdf, commentFor, detectLanguage, locateQuote, type AnnotationTarget } from '../src/consistency/annotate';
import type { Finding, Statement } from '../src/consistency/compare';
import { PDFParse } from 'pdf-parse';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as consistency from '../src/tools/consistency';
import { _resetDownloadLinksForTests } from '../src/downloadLinks';
import { writeXlsx } from './fixtures/office';
import { writePdf } from './fixtures/pdf';

type Box = [number, number, number, number];

interface ReadAnnotation {
  subtype: string;
  rect: Box;
  quadPoints?: Float32Array | number[];
  contentsObj?: { str: string };
  titleObj?: { str: string };
  annotationName?: string;
  popupRef?: string | null;
  overlaidText?: string;
}

/** Annotations and text item boxes of every page, read back with pdfjs. */
async function readBack(pdf: Uint8Array) {
  const parser = new PDFParse({ data: pdf.slice() });
  const doc = await (parser as unknown as { load(): Promise<PDFDocumentProxy> }).load();
  const pages: { annotations: ReadAnnotation[]; text: { str: string; box: Box }[] }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item) => 'str' in item)
      .map((item) => {
        const { str, transform, width, height } = item as { str: string; transform: number[]; width: number; height: number };
        return { str, box: [transform[4], transform[5], transform[4] + width, transform[5] + height] as Box };
      });
    pages.push({ annotations: (await page.getAnnotations()) as ReadAnnotation[], text });
  }
  await parser.destroy();
  return pages;
}

function overlaps(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

function quadBoxes(quads: ArrayLike<number>): Box[] {
  const boxes: Box[] = [];
  for (let i = 0; i < quads.length; i += 8) {
    const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]];
    const ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]];
    boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  return boxes;
}

function finding(statements: Statement[], overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f00d1234abcd',
    type: 'value_conflict',
    severity: 'high',
    subject: 'D-101',
    attribute: 'fire_class',
    summary: 'D-101 — fire class: EI30 vs EI60',
    verdict: 'candidate',
    statements,
    ...overrides,
  };
}

const schedule: Statement = { fileId: 'x1', fileName: 'Dørliste.xlsx', location: 'Døre!row 14', quote: 'D-101 | EI60', value: 'EI60' };
const pdfStatement = (quote: string, location: string): Statement => ({ fileId: 'p1', fileName: 'beskrivelse.pdf', location, quote, value: 'EI30' });
const targetsFor = (statement: Statement, overrides?: Partial<Finding>): AnnotationTarget[] => [
  { finding: finding([statement, schedule], overrides), statement },
];

describe('annotated-PDF export', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-annotate-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const danishPage = [
    'Generelt om projektet og udbuddet.',
    'Dør D-101 udføres som EI30 med bredde 1,2 m.',
    'Dørene skal leveres med karm og greb, og det er',
    'entreprenørens ansvar at dørene er godkendt til',
    'brug i fugtige rum.',
  ];

  it('highlights the quote on its page with a Danish comment and keeps the original bytes in front', async () => {
    const source = new Uint8Array(readFileSync(writePdf(dir, 'a.pdf', [['Side et.'], danishPage])));
    const statement = pdfStatement('Dør D-101 udføres som EI30 med bredde 1,2 m.', 'p. 2');
    const result = await annotatePdf(source, targetsFor(statement));

    expect(result.placements).toEqual([{ findingId: 'f00d1234abcd', page: 2, matched: true }]);
    expect(result.language).toBe('da');
    expect(Buffer.from(result.pdf.subarray(0, source.length)).equals(Buffer.from(source))).toBe(true);

    const pages = await readBack(result.pdf);
    expect(pages[0].annotations).toEqual([]);
    const highlight = pages[1].annotations.find((a) => a.subtype === 'Highlight')!;
    expect(highlight.contentsObj?.str).toBe(
      "Uoverensstemmelse (høj, value_conflict): D-101 brandklasse. Dette dokument: EI30. Modstrid med Dørliste.xlsx, ark 'Døre', række 14: EI60. [finding f00d1234abcd]",
    );
    expect(highlight.titleObj?.str).toBe('Dalux MCP');
    expect(pages[1].annotations.some((a) => a.subtype === 'Popup')).toBe(true);
    const line = pages[1].text.find((t) => t.str.startsWith('Dør D-101'))!.box;
    const boxes = quadBoxes(highlight.quadPoints!);
    expect(boxes).toHaveLength(1);
    expect(overlaps(boxes[0], line)).toBe(true);
    // Not the lines above or below (shrunk by the highlight's padding).
    for (const other of pages[1].text.filter((t) => !t.str.startsWith('Dør D-101'))) {
      expect(overlaps([boxes[0][0], boxes[0][1] + 3, boxes[0][2], boxes[0][3] - 3], other.box)).toBe(false);
    }
    expect(highlight.overlaidText).toBe('Dør D-101 udføres som EI30 med bredde 1,2 m.');

    const written = await PDFDocument.load(result.pdf);
    const annots = written.getPage(1).node.Annots()!;
    const names = annots.asArray().map((ref) => written.context.lookup(ref, PDFDict).get(PDFName.of('NM')));
    expect(names.filter(Boolean).map((name) => (name as PDFHexString).decodeText())).toEqual(['f00d1234abcd']);
  });

  it('covers a quote that runs over several lines with one quad per line', async () => {
    const source = new Uint8Array(readFileSync(writePdf(dir, 'b.pdf', [danishPage])));
    const quote = 'Dørene skal leveres med karm og greb, og det er entreprenørens ansvar at dørene er godkendt til brug i fugtige rum.';
    const result = await annotatePdf(source, targetsFor(pdfStatement(quote, 'p. 1')));
    const [page] = await readBack(result.pdf);
    const highlight = page.annotations.find((a) => a.subtype === 'Highlight')!;
    expect(highlight.overlaidText?.replace(/\s+/g, ' ')).toBe(quote);
    const boxes = quadBoxes(highlight.quadPoints!);
    expect(boxes).toHaveLength(3);
    danishPage.slice(2).forEach((text, i) => {
      expect(overlaps(boxes[i], page.text.find((t) => t.str === text)!.box)).toBe(true);
    });
  });

  it('places highlights in user space on rotated, cropped pages', async () => {
    const source = new Uint8Array(
      readFileSync(writePdf(dir, 'c.pdf', [danishPage, danishPage], ['/Rotate 90 /CropBox [36 36 576 756]', '/Rotate 270'])),
    );
    const statement = pdfStatement('Dør D-101 udføres som EI30 med bredde 1,2 m.', 'p. 1');
    const result = await annotatePdf(source, [...targetsFor(statement), ...targetsFor({ ...statement, location: 'p. 2' })]);
    const pages = await readBack(result.pdf);
    for (const page of pages) {
      const highlight = page.annotations.find((a) => a.subtype === 'Highlight')!;
      const line = page.text.find((t) => t.str.startsWith('Dør D-101'))!.box;
      expect(quadBoxes(highlight.quadPoints!).every((box) => overlaps(box, line))).toBe(true);
    }
  });

  it('finds quotes on a neighbouring page, and leaves a counted page note when the quote is missing', async () => {
    const source = new Uint8Array(readFileSync(writePdf(dir, 'd.pdf', [['Indledning til projektet.'], danishPage])));
    const result = await annotatePdf(source, [
      ...targetsFor(pdfStatement('Dør D-101 udføres som EI30 med bredde 1,2 m.', 'p. 1')),
      ...targetsFor(pdfStatement('Dør D-101 skal være EI30 og selvlukkende.', 'p. 1'), { id: 'beef00000002' }),
    ]);
    expect(result.placements).toEqual([
      { findingId: 'f00d1234abcd', page: 2, matched: true },
      { findingId: 'beef00000002', page: 1, matched: false },
    ]);
    const [first] = await readBack(result.pdf);
    const note = first.annotations.find((a) => a.subtype === 'Text')!;
    expect(note.contentsObj?.str).toContain('Citatet blev ikke fundet på siden: "Dør D-101 skal være EI30 og selvlukkende."');
    expect(note.contentsObj?.str).toContain('[finding beef00000002]');
    // Top-left of the page.
    expect(note.rect[0]).toBeLessThan(100);
    expect(note.rect[3]).toBeGreaterThan(700);
  });

  it('refuses encrypted PDFs', async () => {
    const plain = await PDFDocument.load(readFileSync(writePdf(dir, 'e.pdf', [danishPage])));
    plain.encrypt({ userPassword: 'secret', ownerPassword: 'owner' });
    const encrypted = await plain.save();
    await expect(annotatePdf(encrypted, targetsFor(pdfStatement('Dør D-101', 'p. 1')))).rejects.toThrow(/encrypt/i);
  });

  it('matches across ligatures, hyphenated line breaks and whitespace', () => {
    const item = (str: string, y: number, hasEOL = true) => ({ str, transform: [12, 0, 0, 12, 72, y], width: str.length * 6, height: 12, hasEOL });
    const items = [item('Overﬂaden skal bygge-', 700), item('rietets  krav opfyldes.', 682)];
    const quads = locateQuote(items, 'Overfladen skal byggerietets krav opfyldes.');
    expect(quads).toHaveLength(16);
    expect(locateQuote(items, 'Noget helt andet står her.')).toBeNull();
    // Fuzzy: start and end match, the middle differs a little.
    expect(locateQuote(items, 'Overfladen skal byggeriets krav opfyldes.')).toHaveLength(16);
  });

  it('matches table text that the extractor read in a different order', () => {
    const cell = (str: string, x: number) => ({ str, transform: [10, 0, 0, 10, x, 500], width: str.length * 5, height: 10 });
    const items = [cell('Termin 4: Mekanisk færdiggørelse af anlægget', 72), cell('Der henvises til definitionerne i bilag 8.1', 320)];
    const quads = locateQuote(items, 'Der henvises til definitionerne i bilag 8.1 Termin 4: Mekanisk færdiggørelse af anlægget');
    expect(quads).toHaveLength(8);
    // One line from the first cell into the second.
    expect(quads![0]).toBeLessThan(320);
    expect(quads![2]).toBeGreaterThan(320);
    expect(locateQuote(items, 'Der henvises til et helt andet bilag om noget andet end terminer')).toBeNull();
  });

  it('writes English comments for English documents', () => {
    expect(detectLanguage('The doors shall be delivered with frames and the contractor is responsible.')).toBe('en');
    const statement = pdfStatement('Door D-101 is EI30.', 'p. 3');
    expect(commentFor(finding([statement, schedule]), statement, 'en')).toBe(
      "Inconsistency (high, value_conflict): D-101 fire class. This document: EI30. Conflicts with Dørliste.xlsx, sheet 'Døre', row 14: EI60. [finding f00d1234abcd]",
    );
  });

  it('exports a zip with one annotated copy per affected PDF and the register', async () => {
    const cache = mkdtempSync(path.join(tmpdir(), 'dalux-annotate-cache-'));
    const saved = { cache: process.env.DALUX_MCP_CACHE_DIR, key: process.env.MISTRAL_API_KEY };
    process.env.DALUX_MCP_CACHE_DIR = cache;
    delete process.env.MISTRAL_API_KEY;
    try {
      const sources: Record<string, { fileName: string; source: string }> = {
        f1: { fileName: 'Dørliste.xlsx', source: writeXlsx(dir, 'doerliste.xlsx', [{ name: 'Døre', rows: [['Dør', 'Brandklasse'], ['D-101', 'EI60']] }]) },
        f2: { fileName: 'beskrivelse.pdf', source: writePdf(dir, 'beskrivelse.pdf', [['Indledning.'], danishPage]) },
        f3: { fileName: 'udbud.pdf', source: writePdf(dir, 'udbud.pdf', [['Ingen konflikter her.']]) },
      };
      const client = {
        files: {
          listFiles: jest.fn(async () => ({
            items: Object.entries(sources).map(([fileId, { fileName }]) => ({
              fileId, fileName, folderId: 'root', fileType: 'document', contentHash: 'v1', downloadLink: `link:${fileId}`, fileSize: 1024, deleted: false,
            })),
            metadata: { totalRemainingItems: 0 },
          })),
          downloadFileFromLink: jest.fn(async (link: string, name: string, target: string) => {
            copyFileSync(sources[link.replace('link:', '')].source, path.join(target, name));
            return path.join(target, name);
          }),
          getFile: jest.fn(),
        },
        folders: { listFolders: jest.fn(async () => ({ items: [], metadata: { totalRemainingItems: 0 } })), getFolderByPath: jest.fn() },
      } as unknown as DaluxClient;

      const { reportId } = await consistency.checkDocumentConsistency(client, { projectId: 'p1', fileAreaId: 'fa1', useModel: false });
      const exported = await consistency.exportInconsistencyReport(client, { reportId, format: 'annotated-pdf' });
      expect(exported).toMatchObject({ reportId, format: 'annotated-pdf', findingsCount: 1, annotatedFiles: 1, unmatchedQuotes: 0 });
      expect(exported.fileName).toMatch(/\.zip$/);
      expect(exported.downloadUrl).toMatch(/^http/);

      const zip = unzipSync(readFileSync(exported.filePath));
      expect(Object.keys(zip).sort()).toEqual(['beskrivelse.pdf.annotated.pdf', `consistency-report-${reportId}.xlsx`]);
      const [, page] = await readBack(zip['beskrivelse.pdf.annotated.pdf']);
      expect(page.annotations.find((a) => a.subtype === 'Highlight')?.contentsObj?.str).toContain("Modstrid med Dørliste.xlsx, ark 'Døre', række 2: EI60");
      const register = unzipSync(zip[`consistency-report-${reportId}.xlsx`]);
      expect(strFromU8(register['xl/workbook.xml'])).toContain('name="Annotations"');
      expect(strFromU8(register['xl/worksheets/sheet2.xml'])).toContain('Highlighted');
    } finally {
      await _resetDownloadLinksForTests();
      if (saved.cache === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
      else process.env.DALUX_MCP_CACHE_DIR = saved.cache;
      if (saved.key !== undefined) process.env.MISTRAL_API_KEY = saved.key;
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
