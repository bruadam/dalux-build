import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
  },
  webpack(config) {
    // dalux-build-api treats dotenv as optional. Runtime configuration is
    // supplied by Compose, so do not bundle a package that is never used.
    config.resolve.alias.dotenv = false;
    return config;
  },
};

export default nextConfig;
