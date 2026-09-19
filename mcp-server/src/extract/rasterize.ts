/**
 * Renders one PDF page — including drawing exports — to a PNG image.
 *
 * This is for content the text layer can't carry: symbols, dimension lines,
 * hatching, linework. extractPdf (./pdf.ts) stays the default because reading
 * text is cheap; this is the fallback for when an agent actually needs to
 * look at the sheet.
 *
 * pdfjs-dist's legacy Node build already creates its own @napi-rs/canvas
 * internally (via a runtime `require`) for temporary canvases it needs while
 * rendering — masks, patterns, meshes — so no custom CanvasFactory needs to
 * be wired in here; only the page's own output canvas is created by hand.
 *
 * That sharing is also why the canvas module is resolved through pdfjs rather
 * than from here: @napi-rs/canvas is a NATIVE addon, and a canvas built by one
 * copy of it is an opaque pointer the other copy cannot read. pdfjs declares
 * `@napi-rs/canvas: ^0.1.80` as an optionalDependency; this package declared
 * `^1.0.9`, an incompatible major, so npm installed BOTH — pdfjs resolving
 * 0.1.80 from the workspace root and this file resolving 1.0.9 from
 * mcp-server/node_modules. Handing a 1.0.9 canvas to a 0.1.80 renderer
 * segfaulted the whole process inside `page.render()`, on every PDF, with no
 * JS error to catch: the MCP server simply died mid-call and the client saw a
 * hang. Resolving through pdfjs keeps the two on one binding whatever the
 * install layout hoists, which is the invariant that actually matters — the
 * version pin below is aligned too, so only one copy is installed at all.
 *
 * pdfjs-dist's legacy build is ESM-only (pdf.mjs, no CJS entry point), so
 * it's loaded with `createRequire` rather than a static import: Node's own
 * require() has handled synchronous require-of-ESM since 22.12, but both
 * tsup/esbuild and ts-jest lower a plain `import()` written in TS down to a
 * `require()` of their own when targeting CommonJS — and both Jest's sandboxed
 * module loader and (for the built server) marking the package external to
 * keep esbuild from touching pdf.mjs at all fall over on that path. A
 * `createRequire`d function is Node's real require, untouched by either.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const nodeRequire = createRequire(__filename);

/**
 * `require` rooted at pdfjs's own package, so `@napi-rs/canvas` resolves to the
 * copy pdfjs will render with. See the note at the top of this file: the two
 * must be one native binding or `page.render()` segfaults.
 */
const pdfjsRequire = createRequire(nodeRequire.resolve('pdfjs-dist/package.json'));

// pdfjs joins this with a font filename by plain string concatenation, so it
// needs the trailing separator; without it, non-embedded standard fonts (a
// title block set in plain Helvetica, say) fall back to a generic glyph shape.
const STANDARD_FONT_DATA_URL = `${path.join(path.dirname(nodeRequire.resolve('pdfjs-dist/package.json')), 'standard_fonts')}${path.sep}`;

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
/** Longest edge, in pixels, a rendered page is allowed to reach regardless of requested scale. */
const MAX_DIMENSION = 2048;

export interface RasterizedPage {
  png: Buffer;
  width: number;
  height: number;
  pageCount: number;
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type CanvasModule = typeof import('@napi-rs/canvas');

let pdfjs: PdfjsModule | undefined;
function loadPdfjs(): PdfjsModule {
  pdfjs ??= nodeRequire('pdfjs-dist/legacy/build/pdf.mjs') as PdfjsModule;
  return pdfjs;
}

let canvasLib: CanvasModule | undefined;
function loadCanvas(): CanvasModule {
  if (canvasLib) return canvasLib;
  // By specifier first: that is what a test's module mock intercepts, and in a
  // correctly-deduplicated tree it already resolves to pdfjs's copy. The
  // pdfjs-rooted resolution is the guard for a tree where it does not.
  const own = nodeRequire('@napi-rs/canvas') as CanvasModule;
  let resolved: CanvasModule = own;
  try {
    const ownPath = nodeRequire.resolve('@napi-rs/canvas');
    const pdfjsPath = pdfjsRequire.resolve('@napi-rs/canvas');
    if (pdfjsPath !== ownPath) resolved = nodeRequire(pdfjsPath) as CanvasModule;
  } catch {
    // pdfjs's optional native dep is absent (it is optional); `own` is all
    // there is, and pdfjs will fall back to whatever it can find too.
  }
  canvasLib = resolved;
  return canvasLib;
}

/**
 * Rasterizes `pageNumber` (1-based) of the PDF at `filePath`.
 *
 * `scale` is relative to the PDF's own points (1 = 72 dpi) and is clamped to
 * [0.5, 4], then reduced further if needed to keep the longest edge within
 * MAX_DIMENSION — an A0 sheet at scale 4 would otherwise produce a
 * multi-hundred-megapixel image.
 */
export async function rasterizePdfPage(filePath: string, pageNumber: number, scale: number): Promise<RasterizedPage> {
  const pdfjs = loadPdfjs();
  const canvasLib = loadCanvas();

  // pdf.mjs polyfills globalThis.Path2D from @napi-rs/canvas itself, but only
  // if nothing has set it yet — and pdf-parse (see extract/pdf.ts) polyfills
  // the same global from its own nested, differently-versioned copy of
  // @napi-rs/canvas as a side effect of just being imported. Whichever loads
  // first wins the global, and a Path2D built by the other package's native
  // binding gets rejected by this canvas's context ("Value is none of these
  // types `String`, `Path`"). Re-assign it every call so this render always
  // uses the Path2D that matches the canvas it's actually drawing into.
  (globalThis as Record<string, unknown>).Path2D = canvasLib.Path2D;

  const data = new Uint8Array(readFileSync(filePath));
  const loadingTask = pdfjs.getDocument({ data, disableFontFace: true, standardFontDataUrl: STANDARD_FONT_DATA_URL });

  try {
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    if (pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`Page ${pageNumber} is out of range — this PDF has ${pageCount} page(s).`);
    }

    const page = await doc.getPage(pageNumber);
    const requestedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const unscaled = page.getViewport({ scale: 1 });
    const dimensionCap = MAX_DIMENSION / Math.max(unscaled.width, unscaled.height);
    const effectiveScale = Math.min(requestedScale, dimensionCap);
    const viewport = page.getViewport({ scale: effectiveScale });

    const canvas = canvasLib.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas: canvas as never, viewport }).promise;

    return {
      png: canvas.toBuffer('image/png'),
      width: canvas.width,
      height: canvas.height,
      pageCount,
    };
  } finally {
    await loadingTask.destroy();
  }
}
