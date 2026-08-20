#!/usr/bin/env node
// Fails if any changeset names a package that isn't an npm workspace member.
//
// `changeset version` errors with "Found changeset X for package Y which is
// not in the workspace" and aborts the whole release, but that only happens on
// push to main — long after the bad changeset was merged. Twice now a changeset
// has named "dalux-build" (the private *root* package, and the name of the
// Python distribution) instead of the workspace package "dalux-build-api",
// silently blocking a release. Python versions are synced separately by
// scripts/sync-python-version.mjs, so the Python package never belongs here.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const readPkg = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

const patterns = readPkg(rootDir).workspaces ?? [];
const workspaceNames = new Set(
  globSync(patterns, { cwd: rootDir })
    .map((rel) => join(rootDir, rel))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .map((dir) => readPkg(dir).name),
);

if (workspaceNames.size === 0) {
  console.error("No workspace packages resolved — check `workspaces` in package.json.");
  process.exit(1);
}

const changesetDir = join(rootDir, ".changeset");
const errors = [];

for (const file of readdirSync(changesetDir).filter((f) => f.endsWith(".md"))) {
  if (file.toLowerCase() === "readme.md") continue;
  const text = readFileSync(join(changesetDir, file), "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (frontmatter === undefined) {
    errors.push(`${file}: no frontmatter block found`);
    continue;
  }
  const named = [...frontmatter.matchAll(/^\s*["']([^"']+)["']\s*:/gm)].map((m) => m[1]);
  if (named.length === 0) errors.push(`${file}: frontmatter names no packages`);
  for (const name of named) {
    if (!workspaceNames.has(name)) errors.push(`${file}: "${name}" is not a workspace package`);
  }
}

const known = [...workspaceNames].sort().join(", ");
if (errors.length > 0) {
  for (const e of errors) console.error(`::error::${e}`);
  console.error(`\nValid workspace packages: ${known}`);
  console.error("Python versions are synced from the JS version, so never name the Python package.");
  process.exit(1);
}

console.log(`All changesets reference valid workspace packages (${known}).`);
