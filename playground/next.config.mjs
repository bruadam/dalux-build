import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The dalux-build-api client is a local CommonJS package (file:..).
  // Let Next transpile it so its `require`-based modules bundle cleanly.
  transpilePackages: ['dalux-build-api'],
  // The linked client lives in the parent repo (../src via the file:.. link),
  // so the workspace root must be the repo root for Turbopack to resolve it.
  turbopack: { root: join(__dirname, '..') },
};

export default nextConfig;
