#!/usr/bin/env node
// Wraps `changeset publish` so that re-running the release job after the
// current javascript/package.json version was already published to npm
// (e.g. a later push to main that only touched python/) exits cleanly
// instead of failing with "cannot publish over previously published
// version". `changeset publish` is still used to write/refresh the git
// tag, so it's skipped entirely (not just tolerated) once npm already has
// this version.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(rootDir, "javascript", "package.json"), "utf8"));
const { name, version } = pkg;

let alreadyPublished = false;
try {
  execSync(`npm view ${name}@${version} version`, { stdio: "pipe" });
  alreadyPublished = true;
} catch {
  alreadyPublished = false;
}

if (alreadyPublished) {
  console.log(`${name}@${version} is already on npm, skipping publish.`);
  process.exit(0);
}

execSync("npx changeset publish", { stdio: "inherit" });
