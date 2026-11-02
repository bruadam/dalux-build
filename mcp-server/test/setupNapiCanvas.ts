/**
 * `pdf-parse`'s bundled `pdfjs-dist` references the bare global `DOMMatrix`
 * at import time. In a real `node scripts/*.mjs`/built-server run this is
 * already defined by the time `pdf-parse` loads, because something earlier
 * in that process's actual startup path requires `@napi-rs/canvas` first —
 * which is also true for `pnpm`/`npm` running this file directly with plain
 * `node` (verified by hand: `node -e "require('pdf-parse')"` succeeds with
 * no setup at all).
 *
 * Under Jest, each test file gets its own fresh module registry, and
 * `import { PDFParse } from 'pdf-parse'` (`src/extract/pdf.ts`) can be the
 * very first thing in a file's whole module graph to touch anything
 * pdf.js-related — `extract.rasterize.test.ts`'s own `jest.mock` of
 * `@napi-rs/canvas` has nothing to do with this file, and a file that never
 * imports `./rasterize` has no other code path that would load it first.
 * So the global the real startup path happens to provide for free isn't
 * guaranteed here, and whether it IS provided became sensitive to the exact
 * node_modules layout: before `@napi-rs/canvas` was correctly pinned to the
 * one version pdfjs-dist's own optionalDependency actually wants (see
 * `rasterize.ts`'s top-of-file comment), an extra, invalid, mismatched
 * nested copy happened to load early enough somewhere else to set this
 * global as a side effect; fixing that pin and removing the invalid copy
 * removed that accidental head start along with it.
 *
 * Setting it explicitly here removes the accident: every test file gets the
 * same real `DOMMatrix` `@napi-rs/canvas` itself exports, independent of
 * which other modules happened to load first or in what order.
 */
import { DOMMatrix } from '@napi-rs/canvas';

if (typeof (globalThis as Record<string, unknown>).DOMMatrix === 'undefined') {
  (globalThis as Record<string, unknown>).DOMMatrix = DOMMatrix;
}
