import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    next: 'src/next.ts',
    // Browser-safe, fetch-injectable. Kept a separate entry rather than a
    // condition on `index` so a bundler resolving `dalux-build-api/web`
    // cannot reach axios, `fs` or `FilesApi` even transitively — the
    // guarantee is enforced by the module graph, not by a build flag.
    web: 'src/web.ts',
  },
  // ESM alongside CJS: a browser/Vite consumer needs `import`, and tree
  // shaking a CJS bundle is guesswork.
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
});
