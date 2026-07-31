#!/usr/bin/env node
// Keeps the Python package in lockstep with the npm workspace package
// (javascript/) after `changeset version` bumps javascript/package.json and
// writes javascript/CHANGELOG.md. Run as part of the `version` script so
// both packages ship the same release number and the same release notes:
//   1. Copies the new version into python/pyproject.toml.
//   2. Mirrors the newest `## X.Y.Z` section of javascript/CHANGELOG.md into
//      python/CHANGELOG.md, retitled for the Python package. Idempotent:
//      re-running before the version PR is merged (e.g. a second changeset
//      landed) replaces that section instead of duplicating it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(rootDir, "javascript", "package.json"), "utf8"));
const version = pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`javascript/package.json: expected an X.Y.Z version, got ${JSON.stringify(version)}`);
  process.exit(1);
}

const pyprojectPath = join(rootDir, "python", "pyproject.toml");
const pyproject = readFileSync(pyprojectPath, "utf8");
const versionLineRe = /^version = ".*"$/m;

if (!versionLineRe.test(pyproject)) {
  console.error("python/pyproject.toml: no `version = \"...\"` line was found to update");
  process.exit(1);
}

writeFileSync(pyprojectPath, pyproject.replace(versionLineRe, `version = "${version}"`));
console.log(`python/pyproject.toml -> ${version}`);

/** Returns { heading, section } for the first `## ` block in a changelog, or null. */
function firstSection(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## "));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return {
    heading: lines[start].slice("## ".length).trim(),
    section: lines.slice(start, end).join("\n").trimEnd(),
  };
}

const jsChangelogPath = join(rootDir, "javascript", "CHANGELOG.md");
if (!existsSync(jsChangelogPath)) {
  // Empty changesets (docs/CI-only PRs) bump nothing and write no changelog.
  process.exit(0);
}

const newest = firstSection(readFileSync(jsChangelogPath, "utf8"));
if (!newest) {
  console.log("javascript/CHANGELOG.md: no `## ` version section found, skipping python/CHANGELOG.md sync");
  process.exit(0);
}

const pythonPackageName = "dalux-build";
const pythonChangelogPath = join(rootDir, "python", "CHANGELOG.md");

let rest = "";
if (existsSync(pythonChangelogPath)) {
  const existingBody = readFileSync(pythonChangelogPath, "utf8").replace(/^# .*\n/, "");
  const existingFirst = firstSection(existingBody);
  // Same version re-versioned before the release PR merged: replace, don't duplicate.
  rest = existingFirst && existingFirst.heading === newest.heading
    ? existingBody.slice(existingBody.indexOf(existingFirst.section) + existingFirst.section.length).trimStart()
    : existingBody.trimStart();
}

const pythonChangelog = `# ${pythonPackageName}\n\n${newest.section}\n${rest ? `\n${rest}` : ""}`;
writeFileSync(pythonChangelogPath, pythonChangelog.trimEnd() + "\n");
console.log(`python/CHANGELOG.md -> synced "${newest.heading}" section`);
