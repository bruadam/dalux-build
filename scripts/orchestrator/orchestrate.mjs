#!/usr/bin/env node
// The orchestrator: turn observable repo state into issues agents can claim.
//
// The principle borrowed from ifc-lite is not "run agents" -- it is that work
// is admitted through a queue, claimed explicitly, and gated on evidence.
// Agents collide when they infer work; they collaborate when the work is
// written down, visible, and claimed. So this script never edits code. Its only
// output is issues, each one a unit of work with the evidence already attached.
//
// Four properties, each the result of a mistake worth not repeating:
//
//   1. DRY RUN BY DEFAULT. `--apply` is required to create anything. A tool
//      that files issues on first run teaches you to distrust it.
//   2. IDEMPOTENT. Every issue carries an HTML-comment marker keyed to the
//      signal. A re-run finds the open issue and leaves it alone rather than
//      filing a duplicate.
//   3. FAILURE-TOLERANT PER SIGNAL. One `gh` call failing must not take the
//      run down, or a transient API error looks like "nothing to do".
//   4. IT DOES NOT LABEL `ready`. Creating an issue proposes work; admitting it
//      is a human act. This mirrors ifc-lite, where the queue gate requires a
//      maintainer's label and an agent cannot self-admit. `--ready` overrides
//      for a solo maintainer who wants the loop closed.
//
// Usage:
//   node scripts/orchestrator/orchestrate.mjs              # report only
//   node scripts/orchestrator/orchestrate.mjs --apply      # file issues
//   node scripts/orchestrator/orchestrate.mjs --apply --ready
//   node scripts/orchestrator/orchestrate.mjs --json

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure } from './parity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const REPO = process.env.ORCHESTRATOR_REPO ?? 'bruadam/dalux-build';
const MARKER = 'orchestrator:signal';

/** Priority bands. P1 blocks a release, P2 is correctness, P3 is hygiene. */
const P1 = 'P1';
const P2 = 'P2';
const P3 = 'P3';

function gh(args, { allowFail = true } = {}) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (!allowFail) throw error;
    process.stderr.write(`  (signal degraded: gh ${args.slice(0, 3).join(' ')} -- ${String(error.message).split('\n')[0]})\n`);
    return null;
  }
}

function ghJson(args) {
  const out = gh(args);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// -- Signals ------------------------------------------------------------------
// Each returns an array of { key, priority, title, body }. `key` must be
// stable for the same underlying problem and different for a different one.

/** New JS <-> Python asymmetry beyond the accepted baseline. */
function signalParityDrift() {
  const baselinePath = join(HERE, 'parity-baseline.json');
  const accepted = existsSync(baselinePath)
    ? new Set(JSON.parse(readFileSync(baselinePath, 'utf8')).accepted)
    : new Set();
  const report = measure();
  const keys = [];
  for (const r of report.groupsMissingPython) keys.push(`group-missing-python:${r.group}`);
  for (const r of report.groupsMissingJs) keys.push(`group-missing-js:${r.group}`);
  for (const r of report.methodDrift) {
    for (const m of r.onlyJs) keys.push(`only-js:${r.group}.${m}`);
    for (const m of r.onlyPy) keys.push(`only-py:${r.group}.${m}`);
  }
  const added = keys.filter((k) => !accepted.has(k));
  if (!added.length) return [];
  return [{
    key: 'parity-drift',
    priority: P2,
    title: `Client parity: ${added.length} new JS/Python asymmetr${added.length === 1 ? 'y' : 'ies'}`,
    body: [
      'AGENTS.md states that the Node.js and Python clients stay in behavioural',
      'parity, and that an endpoint added to one should be added to the other in',
      'the same PR. These asymmetries are newer than the recorded baseline:',
      '',
      ...added.map((k) => `- \`${k}\``),
      '',
      'Reproduce: `node scripts/orchestrator/parity.mjs`',
      '',
      '`only-js:` means the Node client has it and Python does not. Note the known',
      'limitation in `parity.mjs`: Python mixin inheritance is invisible to this',
      'check, so a method Python inherits reads as `only-js`. Verify before porting.',
      '',
      'If an asymmetry is deliberate, run `--baseline` and say why in the PR.',
    ].join('\n'),
  }];
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'coverage']);

/** Does a file with this basename exist anywhere in the tree? */
function basenameExists(name, dir = ROOT, depth = 0) {
  if (depth > 6) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (basenameExists(name, join(dir, e.name), depth + 1)) return true;
    } else if (e.name === name) {
      return true;
    }
  }
  return false;
}

/** AGENTS.md pointing at paths that no longer exist. */
function signalAgentsDocDrift() {
  const path = join(ROOT, 'AGENTS.md');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const stale = new Set();
  // Backtick-quoted things that look like repo paths, not prose or URLs.
  for (const m of text.matchAll(/`([a-zA-Z0-9_\-./]+\.(?:ts|js|mjs|py|json|toml|md))`/g)) {
    const ref = m[1];
    if (ref.startsWith('http') || ref.includes('<') || ref.startsWith('.')) continue;
    if (ref.includes('/')) {
      // A real repo-relative path: it must resolve.
      if (!existsSync(join(ROOT, ref))) stale.add(ref);
    } else if (!basenameExists(ref)) {
      // A bare filename is usually illustrative ("one file per group, e.g.
      // `ProjectsApi.ts`"), so resolving it against the repo root would flag
      // every example. Accept it if a file of that name exists ANYWHERE —
      // which still catches a stale extension, the drift that was actually
      // found here (`ProjectsApi.js` when the clients had moved to `.ts`).
      stale.add(ref);
    }
  }
  if (!stale.size) return [];
  return [{
    key: 'agents-md-stale-paths',
    priority: P3,
    title: `AGENTS.md references ${stale.size} path(s) that do not exist`,
    body: [
      'AGENTS.md is the first thing an agent reads. When its paths are wrong, every',
      'agent starts from a false map — and a wrong map is worse than no map, because',
      'it is followed confidently.',
      '',
      ...[...stale].sort().map((p) => `- \`${p}\``),
      '',
      'Reproduce: `node scripts/orchestrator/orchestrate.mjs`',
      '',
      'Check each one: the file may have moved, been renamed (the clients migrated',
      'from `.js` to `.ts`), or the reference may be illustrative rather than real.',
    ].join('\n'),
  }];
}

/**
 * Workflow `name:` values declared in this repo, so runs belonging to GitHub's
 * own machinery are not mistaken for ours.
 */
function ownWorkflowNames() {
  const dir = join(ROOT, '.github', 'workflows');
  if (!existsSync(dir)) return null;
  const names = new Set();
  for (const f of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    const m = readFileSync(join(dir, f), 'utf8').match(/^name:\s*(.+?)\s*$/m);
    if (m) names.add(m[1].replace(/^['"]|['"]$/g, ''));
  }
  return names.size ? names : null;
}

/**
 * The default branch is red *now*, in a workflow this repo owns.
 *
 * Both qualifiers were learned by getting it wrong. The first version reported
 * any failure in the last eight runs, so a failure already followed by a green
 * run was announced as if current. It also counted `Dependabot Updates` --
 * GitHub's own `dynamic` workflow, which fails transiently, is not this repo's
 * test suite, and blocks no release. Reporting that as P1 is how a P1 stops
 * meaning anything.
 */
function signalCiRed() {
  const runs = ghJson(['run', 'list', '--repo', REPO, '--branch', 'main', '--limit', '40', '--json', 'conclusion,status,headSha,url,workflowName,createdAt,event']);
  if (!runs) return [];
  const own = ownWorkflowNames();

  // Latest run per workflow wins; a later success means the failure is history.
  const latest = new Map();
  for (const r of runs) {
    if (r.event === 'dynamic') continue;
    if (own && !own.has(r.workflowName)) continue;
    const prev = latest.get(r.workflowName);
    if (!prev || String(r.createdAt) > String(prev.createdAt)) latest.set(r.workflowName, r);
  }

  const failed = [...latest.values()].filter((r) => r.conclusion === 'failure');
  return failed.map((r) => ({
    key: `ci-red:${r.workflowName}:${(r.headSha ?? '').slice(0, 9)}`,
    priority: P1,
    title: `CI red on main: ${r.workflowName}`,
    body: [
      `Workflow **${r.workflowName}** is failing on \`main\` at \`${(r.headSha ?? '').slice(0, 9)}\`,`,
      'and it is the most recent run of that workflow — not a failure already',
      'superseded by a green one.',
      '',
      `Run: ${r.url}`,
      '',
      'A red default branch blocks release and makes every other signal ambiguous,',
      'so this is P1 regardless of what failed.',
    ].join('\n'),
  }));
}

/** Open PRs touching published client code with no changeset. */
function signalMissingChangeset() {
  const prs = ghJson(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '30', '--json', 'number,title,files,author']);
  if (!prs) return [];
  const needs = [];
  for (const pr of prs) {
    const paths = (pr.files ?? []).map((f) => f.path);
    const touchesRelease = paths.some((p) => p.startsWith('javascript/src/') || p.startsWith('python/dalux_build/'));
    const hasChangeset = paths.some((p) => p.startsWith('.changeset/') && p.endsWith('.md'));
    if (touchesRelease && !hasChangeset) needs.push(pr);
  }
  if (!needs.length) return [];
  return [{
    key: 'missing-changeset',
    priority: P2,
    title: `${needs.length} open PR(s) touch published client code with no changeset`,
    body: [
      'AGENTS.md: every PR touching `javascript/src/`, `javascript/package.json` or',
      '`python/dalux_build/` needs a changeset. Without one the release goes out',
      'without the change, or with a wrong version bump.',
      '',
      ...needs.map((p) => `- #${p.number} ${p.title} (@${p.author?.login ?? 'unknown'})`),
      '',
      'Fix on the PR branch: `npx changeset` — or `npx changeset add --empty` if it',
      'genuinely needs no release.',
    ].join('\n'),
  }];
}

/** Dependency update PRs accumulating. */
function signalDependabotBacklog() {
  const prs = ghJson(['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', '60', '--json', 'number,title,author,createdAt']);
  if (!prs) return [];
  const bots = prs.filter((p) => (p.author?.login ?? '').startsWith('app/dependabot') || p.author?.login === 'dependabot');
  if (bots.length < 5) return [];
  const oldest = bots.map((p) => p.createdAt).sort()[0];
  return [{
    key: 'dependabot-backlog',
    priority: P3,
    title: `${bots.length} dependency PRs open, oldest ${String(oldest).slice(0, 10)}`,
    body: [
      `There are ${bots.length} open automated dependency PRs. Individually they are`,
      'noise; collectively they are a supply-chain lag and they crowd the PR list so',
      'real review gets lost.',
      '',
      'The repo has batched these before — see the history around "batch the',
      'patch/minor dependency bumps". Batching patch and minor into one PR, and',
      'handling majors separately, is the pattern that worked.',
      '',
      ...bots.slice(0, 20).map((p) => `- #${p.number} ${p.title}`),
      bots.length > 20 ? `- …and ${bots.length - 20} more` : '',
    ].filter(Boolean).join('\n'),
  }];
}

/** Admitted work nobody has claimed. */
function signalUnclaimedReady() {
  const issues = ghJson(['issue', 'list', '--repo', REPO, '--state', 'open', '--label', 'ready', '--limit', '40', '--json', 'number,title,comments']);
  if (!issues) return [];
  const unclaimed = issues.filter((i) => !(i.comments ?? []).some((c) => /claiming this/i.test(c.body ?? '')));
  if (!unclaimed.length) return [];
  // Reported, never filed: an issue about unclaimed issues is noise.
  return [{
    key: 'report-only:unclaimed-ready',
    priority: P3,
    reportOnly: true,
    title: `${unclaimed.length} issue(s) labelled ready and unclaimed`,
    body: unclaimed.map((i) => `- #${i.number} ${i.title}`).join('\n'),
  }];
}

const SIGNALS = [
  signalCiRed,
  signalParityDrift,
  signalMissingChangeset,
  signalAgentsDocDrift,
  signalDependabotBacklog,
  signalUnclaimedReady,
];

// -- Issue reconciliation -----------------------------------------------------

function openOrchestratorIssues() {
  const issues = ghJson(['issue', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,body']);
  if (!issues) return new Map();
  const byKey = new Map();
  for (const i of issues) {
    const m = (i.body ?? '').match(new RegExp(`<!--\\s*${MARKER}=([^\\s>]+)\\s*-->`));
    if (m) byKey.set(m[1], i);
  }
  return byKey;
}

function body(finding) {
  return [
    finding.body,
    '',
    '---',
    '',
    'Filed by `scripts/orchestrator/orchestrate.mjs` from observed repo state.',
    'To work on this, comment `Claiming this.` with your session id first — see',
    'AGENTS.md, *Working in parallel*. Not labelled `ready`: admitting work is a',
    'maintainer decision.',
    '',
    `<!-- ${MARKER}=${finding.key} -->`,
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const markReady = args.includes('--ready');
  const asJson = args.includes('--json');

  const findings = [];
  for (const signal of SIGNALS) {
    try {
      findings.push(...signal());
    } catch (error) {
      process.stderr.write(`  (signal ${signal.name} threw: ${String(error.message).split('\n')[0]})\n`);
    }
  }
  const order = { [P1]: 0, [P2]: 1, [P3]: 2 };
  findings.sort((a, b) => order[a.priority] - order[b.priority]);

  if (asJson) {
    console.log(JSON.stringify({ findings }, null, 2));
    return 0;
  }

  if (!findings.length) {
    console.log('✔ nothing to do: no signal fired');
    return 0;
  }

  const existing = apply ? openOrchestratorIssues() : new Map();
  console.log(`${findings.length} signal(s), highest first:\n`);

  for (const f of findings) {
    const tag = f.reportOnly ? 'report' : f.priority;
    console.log(`  [${tag}] ${f.title}`);
    if (f.reportOnly) {
      for (const line of f.body.split('\n')) console.log(`         ${line}`);
      continue;
    }
    if (!apply) continue;

    const already = existing.get(f.key);
    if (already) {
      console.log(`         already open as #${already.number} — left alone`);
      continue;
    }
    const createArgs = [
      'issue', 'create', '--repo', REPO,
      '--title', f.title,
      '--body', body(f),
      '--label', 'agent-task',
      '--label', f.priority,
    ];
    if (markReady) createArgs.push('--label', 'ready');
    const out = gh(createArgs);
    console.log(out ? `         filed: ${out.trim()}` : '         could not file (see error above)');
  }

  if (!apply) console.log('\nDry run. Re-run with --apply to file these as issues.');
  return 0;
}

process.exit(main());
