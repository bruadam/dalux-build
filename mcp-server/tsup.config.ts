import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    server: 'src/server.ts',
  },
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'node',
  // ifc-lite is ESM-only and its WASM bridge resolves its .wasm via
  // createRequire(import.meta.url). Bundled into CJS that becomes `undefined`
  // and GeometryProcessor.init() throws ERR_INVALID_ARG_VALUE, so these must
  // stay external and be reached through a real runtime `import()`.
  //
  // (pdfjs-dist and @napi-rs/canvas — see src/extract/rasterize.ts — have the
  // same kind of resolution problem but are loaded via a plain string handed
  // to createRequire(), which esbuild can't see as an import at all, so they
  // don't need an entry here.)
  external: [/^@ifc-lite\//],
});
