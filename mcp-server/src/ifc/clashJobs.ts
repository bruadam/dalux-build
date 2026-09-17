/**
 * Clash detection as a background job.
 *
 * Meshing tessellates the whole model before anything can be paired, and that
 * cost is both large and unpredictable — the same 2.1MB / 1612-product file
 * measured 299s on one run and 4921s on another. Nothing with that spread can
 * be a blocking tool call, so a clash is started, polled, and collected.
 *
 * Meshes are cached (in clashEngine.ts) against each LoadedModel instance, so
 * a second run on models that are still resident is comparatively cheap
 * (~8s measured per model). Runs may cover more than one model — see
 * clashEngine.runCrossModelClash — which is why this job takes a `models`
 * array rather than a single fileId.
 */
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedModel } from '@ifc-lite/mcp';
import type { ClashRule } from '@ifc-lite/clash';

import { derivedDirFor } from '../cachePaths';
import { runCrossModelClash } from './clashEngine';

export type ClashStatus = 'running' | 'done' | 'error';

export interface ClashJob {
  id: string;
  fileIds: string[];
  ruleNames: string[];
  status: ClashStatus;
  startedAt: number;
  finishedAt?: number;
  progress?: string;
  summary?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  /**
   * Clash list spilled to disk. NOT necessarily complete: the engine caps the
   * array it returns for display and reports the true figure only in
   * `summary.total`, so this holds what was written, not every clash.
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

/** Clashes shown inline/spilled to disk per run, deepest-penetration first. */
const CLASH_DISPLAY_CAP = 50;

/**
 * Types that swamp an unfiltered run without indicating a real problem: rebar
 * sits inside concrete by design (one test model returned 966 clashes, every
 * one IfcReinforcingBar vs IfcSlab), and openings are voids rather than solids.
 *
 * Advisory only — surfaced as a hint on an unfiltered run. A clash rule takes
 * positive type selectors (`a`/`b`), not an exclusion list, so this is not
 * applied automatically; silently dropping types would misreport the total.
 */
export const COMMONLY_DOMINANT_TYPES = ['IfcReinforcingBar', 'IfcOpeningElement', 'IfcSpace'];

export interface StartClashOptions {
  /** Dalux fileIds, in the same order as `models` — the first is where the result JSON is stored. */
  fileIds: string[];
  models: LoadedModel[];
  rules: ClashRule[];
}

export function startClashJob(opts: StartClashOptions): ClashJob {
  const job: ClashJob = {
    id: randomUUID(),
    fileIds: opts.fileIds,
    ruleNames: opts.rules.map((r) => r.name),
    status: 'running',
    startedAt: Date.now(),
    abort: new AbortController(),
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      const result = await runCrossModelClash({
        models: opts.models,
        rules: opts.rules,
        signal: job.abort.signal,
        onProgress: (phase, rule, done, total) => {
          job.progress = `${phase} phase, rule "${rule}": ${done}/${total}`;
        },
      });

      const sorted = [...result.clashes].sort((x, y) => x.distance - y.distance);
      const written = sorted.slice(0, CLASH_DISPLAY_CAP);

      const resultPath = path.join(derivedDirFor(opts.fileIds[0]), `clash-${job.id}.json`);
      await writeFile(
        resultPath,
        JSON.stringify(
          { summary: result.summary, settings: result.settings, truncated: result.truncated, clashes: written },
          null,
          2,
        ),
        'utf-8',
      );

      job.summary = result.summary as unknown as Record<string, unknown>;
      job.settings = result.settings as unknown as Record<string, unknown>;
      job.clashCount = result.summary.total;
      job.clashesWritten = written.length;
      job.resultPath = resultPath;
      job.status = 'done';
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      job.status = 'error';
    } finally {
      job.finishedAt = Date.now();
      job.progress = undefined;
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
    fileIds: job.fileIds,
    rules: job.ruleNames,
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
                  `Only the deepest ${job.clashesWritten} of ${job.clashCount} clashes were kept, so resultPath ` +
                  `holds that subset. summary.byTypePair covers all ${job.clashCount}. Narrow the rule's a/b to see more detail.`,
              }
            : {}),
        }
      : {}),
    ...(job.status === 'error' ? { error: job.error } : {}),
    ...(job.status === 'running'
      ? {
          note: 'Clash meshes every model first; this can take minutes on cold models. Poll ifc_clash_result.',
          progress: job.progress,
        }
      : {}),
  };
}
