/**
 * pdfjs-dist's legacy build is ESM-only, and Jest's require(ESM) interop
 * needs Node 24.9+ to load it directly (see src/extract/rasterize.ts) — this
 * repo's CI Node is older, so pdfjs-dist and @napi-rs/canvas are mocked here
 * to exercise rasterizePdfPage's own logic (page bounds, scale clamping, the
 * MAX_DIMENSION cap, cleanup). The real rendering pipeline — pdfjs actually
 * drawing a page onto a real canvas — was verified by hand with `tsx`, which
 * uses Node's native module loader instead of Jest's.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mockDestroy = jest.fn().mockResolvedValue(undefined);
const mockRenderPromise = jest.fn().mockResolvedValue(undefined);
const mockGetPage = jest.fn();
const mockGetDocument = jest.fn();
const mockCreateCanvas = jest.fn();
class MockPath2D {}

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: mockGetDocument }));
jest.mock('@napi-rs/canvas', () => ({ createCanvas: mockCreateCanvas, Path2D: MockPath2D }));

import { rasterizePdfPage } from '../src/extract/rasterize';

// getDocument is mocked and never actually parses this, so its content doesn't
// matter — only that readFileSync(filePath) has something to read.
let dir: string;
let file: string;

/** Page size in PDF points, matching a US-Letter fixture (612 x 792). */
const PAGE_POINTS = { width: 612, height: 792 };

function setUpDocument(pageCount: number, pagePoints: { width: number; height: number } = PAGE_POINTS) {
  mockGetPage.mockImplementation(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: pagePoints.width * scale,
      height: pagePoints.height * scale,
    }),
    render: () => ({ promise: mockRenderPromise() }),
  }));
  mockGetDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: pageCount, getPage: mockGetPage }),
    destroy: mockDestroy,
  });
}

const fakePng = Buffer.from('fake-png-bytes');

describe('rasterizePdfPage', () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dalux-rasterize-'));
    file = path.join(dir, 'whatever.pdf');
    writeFileSync(file, 'not a real pdf — getDocument is mocked');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    jest.clearAllMocks();
    mockRenderPromise.mockResolvedValue(undefined);
    setUpDocument(2);
    mockCreateCanvas.mockImplementation((width: number, height: number) => ({
      width,
      height,
      getContext: jest.fn(),
      toBuffer: jest.fn().mockReturnValue(fakePng),
    }));
  });

  it('creates a canvas sized to the page at the requested scale and returns its PNG', async () => {
    const result = await rasterizePdfPage(file, 1, 2);

    expect(mockCreateCanvas).toHaveBeenCalledWith(PAGE_POINTS.width * 2, PAGE_POINTS.height * 2);
    expect(result).toEqual({ png: fakePng, width: PAGE_POINTS.width * 2, height: PAGE_POINTS.height * 2, pageCount: 2 });
  });

  it('passes disableFontFace and a standardFontDataUrl to getDocument', async () => {
    await rasterizePdfPage(file, 1, 1);

    expect(mockGetDocument).toHaveBeenCalledWith(
      expect.objectContaining({ disableFontFace: true, standardFontDataUrl: expect.stringMatching(/standard_fonts[/\\]$/) }),
    );
  });

  it('rejects a page number outside the document without creating a canvas', async () => {
    await expect(rasterizePdfPage(file, 3, 1)).rejects.toThrow(/Page 3 is out of range.*2 page/);
    expect(mockCreateCanvas).not.toHaveBeenCalled();
  });

  it('destroys the loading task even when rendering fails', async () => {
    mockRenderPromise.mockRejectedValue(new Error('boom'));

    await expect(rasterizePdfPage(file, 1, 1)).rejects.toThrow('boom');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('clamps an out-of-bounds requested scale to [0.5, 4]', async () => {
    // Small page so scale 4 stays well under the MAX_DIMENSION cap tested separately below.
    const small = { width: 100, height: 100 };
    setUpDocument(2, small);

    await rasterizePdfPage(file, 1, 100);
    expect(mockCreateCanvas).toHaveBeenCalledWith(small.width * 4, small.height * 4);

    await rasterizePdfPage(file, 1, 0.01);
    expect(mockCreateCanvas).toHaveBeenCalledWith(small.width * 0.5, small.height * 0.5);
  });

  it('caps the rendered size to MAX_DIMENSION for a very large page', async () => {
    // An A0 sheet at 72 dpi: ~3370 x 2384 pt — scale 4 would be ~13480px wide.
    setUpDocument(1, { width: 3370, height: 2384 });

    await rasterizePdfPage(file, 1, 4);

    const [width, height] = mockCreateCanvas.mock.calls[0];
    expect(Math.max(width, height)).toBeLessThanOrEqual(2048);
  });

  it('reclaims globalThis.Path2D even if another package already set it to a foreign class', async () => {
    // pdf-parse (extract/pdf.ts) sets `global.Path2D` as a side effect of being
    // imported, from its own separately-versioned copy of @napi-rs/canvas. If
    // that wins the race, pdfjs's `new Path2D()` calls build instances this
    // canvas's native binding won't recognize as a Path2D ("Value is none of
    // these types `String`, `Path`") — see the comment in rasterize.ts.
    class ForeignPath2D {}
    (globalThis as Record<string, unknown>).Path2D = ForeignPath2D;

    await rasterizePdfPage(file, 1, 1);

    expect((globalThis as Record<string, unknown>).Path2D).toBe(MockPath2D);
  });
});
