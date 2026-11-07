import path from 'node:path';

const repoRoot = path.join(import.meta.dirname, '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  experimental: { externalDir: true },
  serverExternalPackages: ['@node-rs/argon2', 'pg'],
};

export default nextConfig;
