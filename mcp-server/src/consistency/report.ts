/**
 * Persisted, resumable consistency reports.
 *
 * Works like the file-area index (rag/build.ts): a report id is derived from
 * the scope, each call works within a time budget, and files whose revision
 * is unchanged keep their extracted facts — so calling again with the same
 * arguments continues a large file area, and a later call after new uploads
 * only re-reads what changed. Comparison itself is cheap and reruns over all
 * stored facts on every pass.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';
import { consistencyReportDir, consistencyRoot, pruneStaleIndexes } from '../cachePaths';
import { pool } from '../concurrency';
import { extractDocument } from '../extract';
import { downloadSource } from '../rag/build';
import { indexIdFor, listIndexableFiles, type IndexScope } from '../rag/scope';
import { summarizeSkips, type FailedFile, type SkipSummary } from '../rag/store';
import { compareFindings, findInconsistencies, type FileFacts, type Finding, type FocusArea } from './compare';
import { extractFacts, type Fact } from './facts';
import { analysisModel, emptyModelUsage, extractFactsWithModel, judgeFinding, type Judgment, type ModelUsage } from './model';
import { mistralUnavailableReason } from '../mistral';

const MANIFEST_VERSION = 1;
const STALE_REPORT_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_CONSISTENCY_EXTENSIONS = ['.pdf', '.docx', '.docm', '.xlsx', '.xlsm', '.csv'];

export interface ConsistencyScope extends IndexScope {
  fileIds: string[] | null;
  focus: FocusArea[] | null;
}

interface FileEntry {
  fileName: string;
  revisionKey: string;
  factCount: number;
  modelExtracted: boolean;
  analyzedAt: string;
}

export interface ReportManifest {
  version: number;
  reportId: string;
  scope: ConsistencyScope;
  createdAt: string;
  updatedAt: string;
  files: Record<string, FileEntry>;
  skipped: SkipSummary[];
  failed: FailedFile[];
  /** Model verdicts by finding id; a finding's id changes when any of its statements does. */
  judgments: Record<string, Judgment & { model: string }>;
  dismissedByModel: number;
  complete: boolean;
}

export function reportIdFor(scope: ConsistencyScope): string {
  const raw = [
    indexIdFor(scope),
    [...(scope.fileIds ?? [])].sort().join(','),
    [...(scope.focus ?? [])].sort().join(','),
  ].join(':');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function safe(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

function manifestPath(reportId: string): string {
  return path.join(consistencyReportDir(reportId), 'manifest.json');
}

function factsPath(reportId: string, fileId: string): string {
  const dir = path.join(consistencyReportDir(reportId), 'facts');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safe(fileId)}.json`);
}

/** Model facts of a file whose model extraction stopped at the time budget, so the next call resumes it. */
interface PartialModelExtraction {
  revisionKey: string;
  batchesDone: number;
  facts: Fact[];
}

function partialPath(reportId: string, fileId: string): string {
  const dir = path.join(consistencyReportDir(reportId), 'partial');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safe(fileId)}.json`);
}

function readPartial(reportId: string, fileId: string, revisionKey: string): PartialModelExtraction | null {
  const file = partialPath(reportId, fileId);
  if (!existsSync(file)) return null;
  const partial = JSON.parse(readFileSync(file, 'utf-8')) as PartialModelExtraction;
  return partial.revisionKey === revisionKey ? partial : null;
}

function findingsPath(reportId: string): string {
  return path.join(consistencyReportDir(reportId), 'findings.json');
}

export function readReportManifest(reportId: string): ReportManifest | null {
  const file = path.join(consistencyRoot(), safe(reportId), 'manifest.json');
  if (!existsSync(file)) return null;
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf-8')) as ReportManifest;
    return manifest.version === MANIFEST_VERSION ? manifest : null;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value), 'utf-8');
}

export function readFindings(reportId: string): Finding[] {
  if (!readReportManifest(reportId)) throw new Error(`No consistency report "${reportId}" on this server — run check_document_consistency first.`);
  const file = findingsPath(reportId);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as Finding[]) : [];
}

function readFacts(reportId: string, fileId: string): Fact[] {
  const file = factsPath(reportId, fileId);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as Fact[]) : [];
}

function mergeFacts(patterns: Fact[], model: Fact[]): Fact[] {
  const seen = new Set(patterns.map((fact) => `${fact.subjectKey}\u0000${fact.attribute}\u0000${fact.value}`));
  return [...patterns, ...model.filter((fact) => !seen.has(`${fact.subjectKey}\u0000${fact.attribute}\u0000${fact.value}`))];
}

export interface CheckOptions {
  maxFiles?: number;
  timeBudgetSeconds?: number;
  maxFileSizeMb?: number;
  /** Defaults to true; the model is only used when mistralUnavailableReason() is null. */
  useModel?: boolean;
}

export interface CheckResult {
  reportId: string;
  complete: boolean;
  mode: 'deterministic' | 'deterministic+model';
  filesInScope: number;
  filesAnalyzed: number;
  filesAnalyzedThisPass: number;
  skipped: SkipSummary[];
  findingsCount: number;
  bySeverity: { high: number; medium: number; low: number };
  topFindings: Finding[];
  dismissedByModel: number;
  /** Mistral calls and tokens spent by this call; present when the model was used. */
  modelUsage?: ModelUsage;
  warnings: string[];
}

export async function checkConsistency(
  client: DaluxClient,
  scope: ConsistencyScope,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const startedAt = Date.now();
  const budgetMs = (options.timeBudgetSeconds ?? 120) * 1000;
  const maxFiles = options.maxFiles ?? 100;
  const maxFileSizeBytes = (options.maxFileSizeMb ?? 60) * 1024 * 1024;
  const outOfTime = () => Date.now() - startedAt > budgetMs;
  const warnings: string[] = [];

  const unavailable = mistralUnavailableReason();
  const useModel = options.useModel !== false && !unavailable;
  const modelUsage = emptyModelUsage();
  if (unavailable && (options.useModel === true || (options.useModel === undefined && process.env.MISTRAL_API_KEY))) {
    warnings.push(`Mistral is not used (${unavailable}) — running deterministic checks only; findings stay verdict "candidate".`);
  }

  pruneStaleIndexes(STALE_REPORT_MS, Date.now(), consistencyRoot());

  const reportId = reportIdFor(scope);
  const manifest: ReportManifest = readReportManifest(reportId) ?? {
    version: MANIFEST_VERSION,
    reportId,
    scope,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    files: {},
    skipped: [],
    failed: [],
    judgments: {},
    dismissedByModel: 0,
    complete: false,
  };

  const listed = await listIndexableFiles(client, scope);
  const wanted = scope.fileIds ? new Set(scope.fileIds) : null;
  const files = wanted ? listed.files.filter((file) => wanted.has(file.fileId)) : listed.files;
  if (wanted) {
    const missing = [...wanted].filter((id) => !files.some((file) => file.fileId === id) && !listed.skipped.some((s) => s.fileId === id));
    if (missing.length) warnings.push(`Not found in this file area/folder: ${missing.join(', ')}.`);
  }
  const skipped = wanted ? listed.skipped.filter((file) => wanted.has(file.fileId)) : listed.skipped;

  const liveIds = new Set(files.map((file) => file.fileId));
  for (const fileId of Object.keys(manifest.files)) {
    if (liveIds.has(fileId)) continue;
    rmSync(factsPath(reportId, fileId), { force: true });
    rmSync(partialPath(reportId, fileId), { force: true });
    delete manifest.files[fileId];
  }

  const failedBefore = new Map(manifest.failed.map((entry) => [entry.fileId, entry]));
  const dirty = files.filter((file) => {
    const entry = manifest.files[file.fileId];
    if (entry && entry.revisionKey === file.revisionKey && (entry.modelExtracted || !useModel)) return false;
    const failure = failedBefore.get(file.fileId);
    return !failure || failure.revisionKey !== file.revisionKey;
  });

  const failed: FailedFile[] = [];
  const sizeSkipped: { fileId: string; fileName: string; reason: string }[] = [];
  const sourceDir = path.join(consistencyReportDir(reportId), 'src');
  mkdirSync(sourceDir, { recursive: true });
  let analyzedThisPass = 0;
  let modelFailure: string | null = null;
  let modelInterrupted = 0;

  await pool(dirty.slice(0, maxFiles), 4, outOfTime, async (file) => {
    if (file.fileSize !== null && file.fileSize > maxFileSizeBytes) {
      sizeSkipped.push({ fileId: file.fileId, fileName: file.fileName, reason: `larger than ${options.maxFileSizeMb ?? 60} MB` });
      return;
    }
    let localPath: string | null = null;
    try {
      localPath = await downloadSource(client, scope, sourceDir, file);
      if (statSync(localPath).size > maxFileSizeBytes) {
        sizeSkipped.push({ fileId: file.fileId, fileName: file.fileName, reason: `larger than ${options.maxFileSizeMb ?? 60} MB` });
        return;
      }
      const extraction = await extractDocument(localPath, file.fileName);
      let facts = extractFacts(extraction.chunks);
      let modelExtracted = useModel && !extraction.chunks.length;
      if (useModel && extraction.chunks.length) {
        try {
          const partial = readPartial(reportId, file.fileId, file.revisionKey);
          const run = await extractFactsWithModel(file.fileName, extraction.chunks, {
            startBatch: partial?.batchesDone ?? 0,
            outOfTime,
            usage: modelUsage,
          });
          const modelFacts = [...(partial?.facts ?? []), ...run.facts];
          facts = mergeFacts(facts, modelFacts);
          modelExtracted = run.batchesDone >= run.batchCount;
          if (modelExtracted) {
            rmSync(partialPath(reportId, file.fileId), { force: true });
          } else {
            writeJson(partialPath(reportId, file.fileId), { revisionKey: file.revisionKey, batchesDone: run.batchesDone, facts: modelFacts });
            modelInterrupted += 1;
          }
        } catch (err) {
          modelFailure = err instanceof Error ? err.message : String(err);
        }
      }
      writeJson(factsPath(reportId, file.fileId), facts);
      manifest.files[file.fileId] = {
        fileName: file.fileName,
        revisionKey: file.revisionKey,
        factCount: facts.length,
        modelExtracted,
        analyzedAt: new Date().toISOString(),
      };
      analyzedThisPass += 1;
    } catch (err) {
      failed.push({
        fileId: file.fileId,
        fileName: file.fileName,
        revisionKey: file.revisionKey,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (localPath) rmSync(localPath, { force: true });
    }
  });
  if (modelFailure) {
    warnings.push(`Mistral fact extraction failed for some files (${modelFailure}); their pattern-based facts are used and they are retried on the next call.`);
  }
  if (modelInterrupted) {
    warnings.push(`${modelInterrupted} file(s) were only partly read by Mistral within timeBudgetSeconds; their progress is saved and the next call continues them.`);
  }

  const retried = new Set(failed.map((entry) => entry.fileId));
  manifest.failed = [
    ...manifest.failed.filter((entry) => liveIds.has(entry.fileId) && !retried.has(entry.fileId)),
    ...failed,
  ];
  manifest.skipped = summarizeSkips([
    ...skipped,
    ...sizeSkipped,
    ...manifest.failed.map((entry) => ({ fileName: entry.fileName, reason: `could not be read: ${entry.error}` })),
  ]);

  const fileFacts: FileFacts[] = Object.entries(manifest.files).map(([fileId, entry]) => ({
    fileId,
    fileName: entry.fileName,
    revisionId: entry.revisionKey || undefined,
    facts: readFacts(reportId, fileId),
  }));
  const candidates = findInconsistencies(fileFacts, scope.focus ?? undefined);

  let unjudged = 0;
  if (useModel) {
    const model = analysisModel();
    const pending = candidates.filter((finding) => manifest.judgments[finding.id]?.model !== model);
    let judgeFailure: string | null = null;
    await pool(pending, 4, outOfTime, async (finding) => {
      try {
        manifest.judgments[finding.id] = { ...(await judgeFinding(finding, modelUsage)), model };
      } catch (err) {
        judgeFailure = err instanceof Error ? err.message : String(err);
      }
    });
    unjudged = pending.filter((finding) => !manifest.judgments[finding.id] || manifest.judgments[finding.id].model !== model).length;
    if (judgeFailure) warnings.push(`Mistral could not judge some findings (${judgeFailure}); they stay "candidate".`);
  }

  const live = new Set(candidates.map((finding) => finding.id));
  for (const id of Object.keys(manifest.judgments)) {
    if (!live.has(id)) delete manifest.judgments[id];
  }

  let dismissed = 0;
  const findings: Finding[] = [];
  for (const finding of candidates) {
    const judgment = manifest.judgments[finding.id];
    if (judgment?.verdict === 'not_a_conflict') {
      dismissed += 1;
      continue;
    }
    findings.push(
      judgment
        ? {
            ...finding,
            verdict: 'confirmed',
            explanation: judgment.explanation || undefined,
            precedenceNote: judgment.precedenceNote || undefined,
          }
        : finding,
    );
  }
  findings.sort(compareFindings);

  const doneIds = new Set([...Object.keys(manifest.files), ...manifest.failed.map((entry) => entry.fileId)]);
  const sizeSkippedIds = new Set(sizeSkipped.map((entry) => entry.fileId));
  const filesPending = files.filter((file) => {
    if (sizeSkippedIds.has(file.fileId)) return false;
    if (!doneIds.has(file.fileId)) return true;
    const entry = manifest.files[file.fileId];
    if (!entry || !useModel || entry.modelExtracted) return false;
    return !modelFailure || existsSync(partialPath(reportId, file.fileId));
  }).length;

  const complete = filesPending === 0 && unjudged === 0;
  if (filesPending) warnings.push(`${filesPending} file(s) still to analyze — call check_document_consistency again with the same arguments to continue.`);
  if (unjudged) warnings.push(`${unjudged} finding(s) still to be judged by the model — call again to continue.`);
  if (!useModel) {
    warnings.push(
      'Findings come from pattern matching only (verdict "candidate"): judge each one against its quotes, using the document-consistency-review and danish-construction-contracts skills (get_skill).',
    );
  }

  manifest.scope = scope;
  manifest.dismissedByModel = dismissed;
  manifest.complete = complete;
  manifest.updatedAt = new Date().toISOString();
  writeJson(findingsPath(reportId), findings);
  writeJson(manifestPath(reportId), manifest);

  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) bySeverity[finding.severity] += 1;

  return {
    reportId,
    complete,
    mode: useModel ? 'deterministic+model' : 'deterministic',
    filesInScope: files.length,
    filesAnalyzed: Object.keys(manifest.files).length,
    filesAnalyzedThisPass: analyzedThisPass,
    skipped: manifest.skipped,
    findingsCount: findings.length,
    bySeverity,
    topFindings: findings.slice(0, 10),
    dismissedByModel: dismissed,
    ...(useModel && { modelUsage }),
    warnings,
  };
}

export interface ReportSummary {
  reportId: string;
  scope: ConsistencyScope;
  complete: boolean;
  filesAnalyzed: number;
  findingsCount: number;
  updatedAt: string;
}

export function listReports(): ReportSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(consistencyRoot());
  } catch {
    return [];
  }
  return entries
    .map((reportId) => readReportManifest(reportId))
    .filter((manifest): manifest is ReportManifest => manifest !== null)
    .map((manifest) => ({
      reportId: manifest.reportId,
      scope: manifest.scope,
      complete: manifest.complete,
      filesAnalyzed: Object.keys(manifest.files).length,
      findingsCount: readFindings(manifest.reportId).length,
      updatedAt: manifest.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function dropReport(reportId: string): boolean {
  const dir = path.join(consistencyRoot(), safe(reportId));
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
