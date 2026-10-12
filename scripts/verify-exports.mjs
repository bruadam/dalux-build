#!/usr/bin/env node
// Guards against publishing a package whose `exports` map points at files the
// tarball does not contain.
//
// dalux-build-api@2.4.0 and @2.5.0 both shipped with *only* package.json and
// README.md in them: `files` lists "dist", nothing ever ran `tsup` before
// `changeset publish`, and neither `npm pack --dry-run` nor `npm publish
// --dry-run` complains when a `files` glob matches nothing. The result was two
// releases that resolved fine on the registry and then failed at the consumer
// with "Cannot find module 'dalux-build-api/web'".
//
// So assert the thing the dry runs don't: every target named in `exports`
// exists on disk, and is covered by a `files` entry so it actually gets packed.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "javascript");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

// `exports` nests subpaths and conditions arbitrarily deep; every leaf string
// that looks like a relative path is a file that must ship.
function collectTargets(node, trail, out) {
  if (typeof node === "string") {
    if (node.startsWith(".")) out.push({ target: node, trail: trail.join(" -> ") });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((entry, i) => collectTargets(entry, [...trail, `[${i}]`], out));
    return out;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      collectTargets(value, [...trail, key], out);
    }
  }
  return out;
}

const targets = collectTargets(pkg.exports ?? {}, [], []);
if (targets.length === 0) {
  console.error("verify-exports: no exports targets found in javascript/package.json.");
  process.exit(1);
}

// A `files` entry covers a path if it names the file or a parent directory of
// it. The real `files` syntax is glob-based, but this package only ever lists
// plain names ("dist", "README.md"), so treat anything else as uncovered and
// let a human look at it rather than guessing.
const fileEntries = (pkg.files ?? []).map((entry) => entry.replace(/^\.\//, "").replace(/\/$/, ""));
const covers = (relPath) =>
  fileEntries.some((entry) => relPath === entry || relPath.startsWith(`${entry}${sep}`));

const problems = [];
for (const { target, trail } of targets) {
  const relPath = relative(pkgDir, resolve(pkgDir, target));
  const abs = join(pkgDir, relPath);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    problems.push(`${target} (exports ${trail}) does not exist — did the build run?`);
    continue;
  }
  if (!covers(relPath)) {
    problems.push(`${target} (exports ${trail}) exists but no "files" entry packs it.`);
  }
}

// `main`/`types`/`module` are what older resolvers and bundlers read; an empty
// tarball breaks them exactly as silently.
for (const field of ["main", "types", "module"]) {
  const value = pkg[field];
  if (typeof value !== "string") continue;
  const relPath = relative(pkgDir, resolve(pkgDir, value));
  if (!existsSync(join(pkgDir, relPath))) {
    problems.push(`"${field}": "${value}" does not exist — did the build run?`);
  } else if (!covers(relPath)) {
    problems.push(`"${field}": "${value}" exists but no "files" entry packs it.`);
  }
}

if (problems.length > 0) {
  console.error(
    `verify-exports: ${pkg.name}@${pkg.version} would publish a broken package:\n` +
      problems.map((p) => `  - ${p}`).join("\n") +
      "\n\nRun `npm run build --workspace=javascript` first.",
  );
  process.exit(1);
}

console.log(
  `verify-exports: ${pkg.name}@${pkg.version} — ${targets.length} exports targets present and packable.`,
);
