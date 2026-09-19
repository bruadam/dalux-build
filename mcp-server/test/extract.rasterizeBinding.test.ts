/**
 * Guards the one thing the rest of the rasterize suite structurally cannot:
 * that pdfjs-dist and src/extract/rasterize.ts get the SAME copy of
 * @napi-rs/canvas.
 *
 * `extract.rasterize.test.ts` mocks both packages to exercise the scale/bounds
 * logic without loading native code, so it stays green no matter how the
 * install tree looks. That is exactly the blind spot that shipped a broken
 * render_pdf_page: this package declared `@napi-rs/canvas: ^1.0.9` while
 * pdfjs-dist declares `^0.1.80` as an optionalDependency, npm installed both,
 * and a canvas allocated by one native binding handed to the other
 * SEGFAULTED the process inside `page.render()` — on every PDF, with no JS
 * error to catch and nothing for a mocked test to notice.
 *
 * This asserts resolution only. It loads neither package, so it is safe on a
 * CI Node too old for jest's require(ESM) interop — the same constraint that
 * forced the mocks next door.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const rasterizeRequire = createRequire(path.join(__dirname, '..', 'src', 'extract', 'rasterize.ts'));

describe('@napi-rs/canvas native binding', () => {
  it('resolves to one copy from both rasterize.ts and pdfjs-dist', () => {
    const pdfjsPackageJson = rasterizeRequire.resolve('pdfjs-dist/package.json');
    const pdfjsRequire = createRequire(pdfjsPackageJson);

    expect(pdfjsRequire.resolve('@napi-rs/canvas')).toBe(rasterizeRequire.resolve('@napi-rs/canvas'));
  });

  it('declares a range compatible with the one pdfjs-dist asks for', () => {
    // The resolution check above passes on a tree npm happened to dedupe; this
    // one fails on the declaration that made deduplication impossible in the
    // first place, which is where the bug actually lived.
    const ours = require('../package.json').dependencies['@napi-rs/canvas'] as string;
    const theirs = require(rasterizeRequire.resolve('pdfjs-dist/package.json'))
      .optionalDependencies['@napi-rs/canvas'] as string;

    const major = (range: string) => range.replace(/^[^0-9]*/, '').split('.').slice(0, 2).join('.');
    expect(major(ours)).toBe(major(theirs));
  });
});
