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
  external: [/^@ifc-lite\//],
});
