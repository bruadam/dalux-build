#!/usr/bin/env node
// Measure JS <-> Python API parity, the discipline AGENTS.md states and
// nothing enforces.
//
// AGENTS.md: "The two clients are expected to stay in behavioral parity -- an
// endpoint or parameter added to one should generally be added to the other in
// the same PR." That is a review habit. A habit is not a gate, and the drift
// this script finds on its first run shows the habit has already slipped.
//
// Design notes, because a scheduled signal that cries wolf gets muted:
//
//   - It compares METHOD NAMES ONLY. Not parameters, not behaviour. A method
//     present on both sides with different semantics passes here. That is a
//     deliberate floor, not an oversight: name-level drift is cheap to detect
//     and unambiguous, while signature comparison across TypeScript and Python
//     overloads needs two real parsers and would produce arguable findings.
//   - It reports against a BASELINE rather than against zero. The repo has
//     pre-existing asymmetries, some of them intentional. Reporting all of them
//     every run would make the signal noise on day one, so `--baseline` records
//     the current state and normal runs report only what CHANGED.
//   - Private helpers (leading `_`), constructors and dunders are excluded;
//     they are implementation, not surface.
//   - Extraction is scoped to the `<Group>Api` CLASS BODY in both languages.
//     The first version of this script was not, and it produced three false
//     findings immediately: `folders.if` and `tasks.if` (a JS `if (` at method
//     indent) and `files.close` / `files.update` (a `_ProgressBar(Protocol)`
//     stub in the same module). Both are fixed below; the episode is recorded
//     because it is the argument for running a new signal before trusting it.
//   - KNOWN LIMITATION: Python mixin inheritance is invisible here.
//     `FilesApi(AiMixin, DashboardApiMixin)` gains methods defined in other
//     modules, and this script counts only methods written in the class's own
//     file. A method JS has and Python inherits will therefore read as
//     `only-js`. Such findings land in the baseline on first run rather than
//     nagging, but a reviewer should know the direction of the error.
//
// Usage:
//   node scripts/orchestrator/parity.mjs             # report drift vs baseline
//   node scripts/orchestrator/parity.mjs --baseline  # record current state
//   node scripts/orchestrator/parity.mjs --json      # machine-readable

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const JS_DIR = join(ROOT, 'javascript', 'src', 'api');
const PY_DIR = join(ROOT, 'python', 'dalux_build', 'api');
const BASELINE = join(HERE, 'parity-baseline.json');

/** `FileRevisionsApi.ts` -> `file_revisions`. */
export function jsFileToGroup(name) {
  return name
    .replace(/Api\.ts$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/** `file_revisions.py` -> `file_revisions`. */
export function pyFileToGroup(name) {
  return name.replace(/\.py$/, '');
}

/** `listProjects` -> `list_projects`, so the two naming conventions compare. */
export function toSnake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Public method names from a TypeScript class body.
 *
 * Matches a two-space-indented `name(` or `name<T>(`, with optional `async` /
 * `public`. Deliberately simple: a real TS parser is not worth a dependency for
 * a name-level check, and this repo's api classes are uniformly formatted.
 */
const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'typeof',
  'do', 'else', 'try', 'throw', 'new', 'delete', 'void', 'yield',
]);

export function jsMethods(source) {
  const out = new Set();
  const body = classBody(source, /^export\s+class\s+\w*Api\b[^{]*\{/m, /^\}/m);
  const re = /^ {2}(?:public\s+)?(?:async\s+)?([A-Za-z][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    // `if (`, `for (` and friends sit at exactly method indent inside a class
    // method. Without this guard they are reported as API surface.
    if (name === 'constructor' || name.startsWith('_') || JS_KEYWORDS.has(name)) continue;
    out.add(toSnake(name));
  }
  return out;
}

/**
 * Text from the line after `open` matches until `close` matches at column 0.
 * Returns the whole source if the opening pattern is absent, so a file that
 * does not follow the convention degrades to the old behaviour rather than
 * silently measuring nothing.
 */
function classBody(source, open, close) {
  const start = source.match(open);
  if (!start || start.index === undefined) return source;
  const after = source.slice(start.index + start[0].length);
  const end = after.match(close);
  return end && end.index !== undefined ? after.slice(0, end.index) : after;
}

/**
 * Public method names from a Python class body.
 *
 * Four-space indent keeps us inside a class and out of module-level helpers.
 * `@overload` stubs repeat a name several times; a Set collapses them, which is
 * correct — an overload set is one surface method.
 */
export function pyMethods(source) {
  const out = new Set();
  // Only the `<Group>Api` class. A module may also define Protocol stubs and
  // helper classes at top level, whose methods are not API surface.
  const body = classBody(source, /^class\s+\w*Api\b[^:]*:/m, /^(?:class|def)\s/m);
  const re = /^ {4}(?:async\s+)?def\s+([a-z][a-z0-9_]*)\s*\(/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m[1].startsWith('_')) continue;
    out.add(m[1]);
  }
  return out;
}

function listGroups() {
  const js = new Map();
  for (const f of readdirSync(JS_DIR)) {
    if (!f.endsWith('Api.ts')) continue;
    js.set(jsFileToGroup(f), { file: `javascript/src/api/${f}`, methods: jsMethods(readFileSync(join(JS_DIR, f), 'utf8')) });
  }
  const py = new Map();
  for (const f of readdirSync(PY_DIR)) {
    if (!f.endsWith('.py') || f === '__init__.py') continue;
    py.set(pyFileToGroup(f), { file: `python/dalux_build/api/${f}`, methods: pyMethods(readFileSync(join(PY_DIR, f), 'utf8')) });
  }
  return { js, py };
}

export function measure() {
  const { js, py } = listGroups();
  const groups = [...new Set([...js.keys(), ...py.keys()])].sort();
  const report = { groupsMissingPython: [], groupsMissingJs: [], methodDrift: [] };

  for (const g of groups) {
    const a = js.get(g);
    const b = py.get(g);
    if (a && !b) { report.groupsMissingPython.push({ group: g, jsFile: a.file }); continue; }
    if (b && !a) { report.groupsMissingJs.push({ group: g, pyFile: b.file }); continue; }
    const onlyJs = [...a.methods].filter((m) => !b.methods.has(m)).sort();
    const onlyPy = [...b.methods].filter((m) => !a.methods.has(m)).sort();
    if (onlyJs.length || onlyPy.length) {
      report.methodDrift.push({ group: g, onlyJs, onlyPy });
    }
  }
  return report;
}

/** Flatten to comparable keys, so baseline diffing is a set operation. */
function toKeys(report) {
  const keys = [];
  for (const r of report.groupsMissingPython) keys.push(`group-missing-python:${r.group}`);
  for (const r of report.groupsMissingJs) keys.push(`group-missing-js:${r.group}`);
  for (const r of report.methodDrift) {
    for (const m of r.onlyJs) keys.push(`only-js:${r.group}.${m}`);
    for (const m of r.onlyPy) keys.push(`only-py:${r.group}.${m}`);
  }
  return keys.sort();
}

function main() {
  const args = process.argv.slice(2);
  const report = measure();
  const keys = toKeys(report);

  if (args.includes('--baseline')) {
    writeFileSync(BASELINE, `${JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), accepted: keys }, null, 2)}\n`);
    console.log(`Recorded ${keys.length} accepted asymmetr${keys.length === 1 ? 'y' : 'ies'} to scripts/orchestrator/parity-baseline.json`);
    console.log('Normal runs now report only NEW drift. Review this file: anything in it is a parity gap you are choosing to keep.');
    return 0;
  }

  const accepted = existsSync(BASELINE) ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).accepted) : new Set();
  const added = keys.filter((k) => !accepted.has(k));
  const fixed = [...accepted].filter((k) => !keys.includes(k));

  if (args.includes('--json')) {
    console.log(JSON.stringify({ report, newDrift: added, closedDrift: fixed }, null, 2));
    return added.length ? 1 : 0;
  }

  if (!added.length && !fixed.length) {
    console.log(`✔ parity unchanged (${accepted.size} accepted asymmetr${accepted.size === 1 ? 'y' : 'ies'})`);
    return 0;
  }
  if (fixed.length) {
    console.log(`✔ ${fixed.length} previously accepted asymmetr${fixed.length === 1 ? 'y was' : 'ies were'} closed:`);
    for (const k of fixed) console.log(`    ${k}`);
    console.log('  Re-run with --baseline to stop tracking them.');
  }
  if (added.length) {
    console.log(`\n❌ ${added.length} NEW parity gap(s):`);
    for (const k of added) console.log(`    ${k}`);
    console.log('\nAGENTS.md: an endpoint added to one client should be added to the other in the');
    console.log('same PR. If an asymmetry is deliberate, run --baseline and say why in the PR.');
  }
  return added.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
