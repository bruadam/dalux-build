/**
 * Clash detection as a background job.
 *
 * `clash_check` tessellates the entire model before it can pair anything, and
 * that cost is both large and unpredictable — the same 2.1MB / 1612-product
 * file measured 299s on one run and 4921s on another. Nothing with that spread
 * can be a blocking tool call, so a clash is started, polled, and collected.
 *
 * Meshes are cached by ifc-lite against the LoadedModel instance, so a second
 * run on a model that is still resident is comparatively cheap (~8s measured).
 */
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModelRegistry } from '@ifc-lite/mcp';

import { derivedDirFor } from '../cachePaths';
import { buildToolContext, callIfcTool } from './runtime';

export type ClashStatus = 'running' | 'done' | 'error';

export interface ClashJob {
  id: string;
  fileId: string;
  status: ClashStatus;
  startedAt: number;
  finishedAt?: number;
  summary?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  /**
   * Clash list spilled to disk. NOT necessarily complete: clash_check caps the
   * array it returns (50 on the runs measured) and reports the true figure only
   * in `summary.total`, so this holds what ifc-lite handed back, not every clash.
   */
  resultPath?: string;
  /** True total from summary.total — not the length of the spilled array. */
  clashCount?: number;
  /** How many clashes were actually written to resultPath. */
  clashesWritten?: number;
  error?: string;
  abort: AbortController;
}

const jobs = new Map<string, ClashJob>();

/**
 * Types that swamp an unfiltered run without indicating a real problem: rebar
 * sits inside concrete by design (one test model returned 966 clashes, every
 * one IfcReinforcingBar vs IfcSlab), and openings are voids rather than solids.
 *
 * Advisory only — surfaced as a hint on an unfiltered run. clash_check takes
 * positive type selectors (`a`/`b`), not an exclusion list, so this is not
 * applied automatically; silently dropping types would misreport the total.
 */
export const COMMONLY_DOMINANT_TYPES = ['IfcReinforcingBar', 'IfcOpeningElement', 'IfcSpace'];

export interface StartClashOptions {
  fileId: string;
  registry: ModelRegistry;
  modelId: string;
  a?: string;
  b?: string;
  mode?: 'hard' | 'clearance';
  tolerance?: number;
  clearance?: number;
}

export function startClashJob(opts: StartClashOptions): ClashJob {
  const job: ClashJob = {
    id: randomUUID(),
    fileId: opts.fileId,
    status: 'running',
    startedAt: Date.now(),
    abort: new AbortController(),
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      const ctx = await buildToolContext(opts.registry, job.abort.signal);
      const input: Record<string, unknown> = { model_id: opts.modelId, mode: opts.mode ?? 'hard' };
      if (opts.a) input.a = opts.a;
      if (opts.b) input.b = opts.b;
      if (opts.tolerance != null) input.tolerance = opts.tolerance;
      if (opts.clearance != null) input.clearance = opts.clearance;

      const { data } = await callIfcTool(ctx, 'clash_check', input);
      const clashes = Array.isArray(data.clashes) ? data.clashes : [];
      const summary = data.summary as { total?: number } | undefined;

      const resultPath = path.join(derivedDirFor(opts.fileId), `clash-${job.id}.json`);
      await writeFile(
        resultPath,
        JSON.stringify(
          { summary: data.summary, settings: data.settings, clashesTruncated: data.clashesTruncated, clashes },
          null,
          2,
        ),
        'utf-8',
      );

      job.summary = data.summary as Record<string, unknown> | undefined;
      job.settings = data.settings as Record<string, unknown> | undefined;
      job.clashCount = typeof summary?.total === 'number' ? summary.total : clashes.length;
      job.clashesWritten = clashes.length;
      job.resultPath = resultPath;
      job.status = 'done';
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      job.status = 'error';
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return job;
}

export function getClashJob(id: string): ClashJob | undefined {
  return jobs.get(id);
}

export function listClashJobs(): ClashJob[] {
  return [...jobs.values()].sort((a, z) => z.startedAt - a.startedAt);
}

export function describeJob(job: ClashJob) {
  return {
    jobId: job.id,
    status: job.status,
    fileId: job.fileId,
    elapsedSeconds: Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000),
    ...(job.status === 'done'
      ? {
          clashCount: job.clashCount,
          clashesWritten: job.clashesWritten,
          summary: job.summary,
          settings: job.settings,
          resultPath: job.resultPath,
          ...(job.clashesWritten != null && job.clashCount != null && job.clashesWritten < job.clashCount
            ? {
                truncated:
                  `ifc-lite returned only the deepest ${job.clashesWritten} of ${job.clashCount} clashes, so resultPath ` +
                  `holds that subset. summary.byTypePair covers all ${job.clashCount}. Narrow a/b to see more detail.`,
              }
            : {}),
        }
      : {}),
    ...(job.status === 'error' ? { error: job.error } : {}),
    ...(job.status === 'running'
      ? { note: 'Clash meshes the whole model first; this can take minutes on a cold model. Poll ifc_clash_result.' }
      : {}),
  };
}
