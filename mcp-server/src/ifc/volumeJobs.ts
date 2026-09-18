/**
 * Volume extraction as a background job, for the same reason clash is one
 * (see clashJobs.ts): it shares the same tessellation step, whose cost is
 * large and unpredictable, so it cannot be a blocking tool call. A model
 * already meshed by a prior clash or volumes run on this process is cheap —
 * see geometryCache.ts, which both share.
 */
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedModel } from '@ifc-lite/mcp';

import { derivedDirFor } from '../cachePaths';
import { extractVolumes, type ElementVolume, type TypeVolumeSummary } from './volumeEngine';

export type VolumeJobStatus = 'running' | 'done' | 'error';

export interface VolumeJob {
  id: string;
  fileId: string;
  type?: string;
  status: VolumeJobStatus;
  startedAt: number;
  finishedAt?: number;
  byType?: TypeVolumeSummary[];
  provedCount?: number;
  totalCount?: number;
  csvPath?: string;
  error?: string;
}

const jobs = new Map<string, VolumeJob>();

function toCsv(elements: ElementVolume[]): string {
  const header = 'GlobalId,Type,Name,VolumeM3\n';
  const rows = elements.map((e) => {
    const name = `"${(e.name ?? '').replace(/"/g, '""')}"`;
    const volume = e.volumeM3 == null ? '' : e.volumeM3.toString();
    return `${e.globalId},${e.type},${name},${volume}`;
  });
  return header + rows.join('\n');
}

export interface StartVolumeJobOptions {
  fileId: string;
  model: LoadedModel;
  type?: string;
}

export function startVolumeJob(opts: StartVolumeJobOptions): VolumeJob {
  const job: VolumeJob = {
    id: randomUUID(),
    fileId: opts.fileId,
    type: opts.type,
    status: 'running',
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  void (async () => {
    try {
      const result = await extractVolumes(opts.model, { type: opts.type });

      const csvPath = path.join(derivedDirFor(opts.fileId), `volumes-${job.id}.csv`);
      await writeFile(csvPath, toCsv(result.elements), 'utf-8');

      job.byType = result.byType;
      job.provedCount = result.provedCount;
      job.totalCount = result.totalCount;
      job.csvPath = csvPath;
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

export function getVolumeJob(id: string): VolumeJob | undefined {
  return jobs.get(id);
}

export function describeVolumeJob(job: VolumeJob) {
  return {
    jobId: job.id,
    status: job.status,
    fileId: job.fileId,
    type: job.type,
    elapsedSeconds: Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000),
    ...(job.status === 'done'
      ? {
          totalCount: job.totalCount,
          provedCount: job.provedCount,
          coverage: job.totalCount ? `${job.provedCount}/${job.totalCount}` : undefined,
          byType: job.byType,
          csvPath: job.csvPath,
          note:
            'volumeM3 is present only where the meshed geometry proved a single closed solid; absent means ' +
            '"unknown", not zero, so totals only sum proved elements. See csvPath for the full per-element table.',
        }
      : {}),
    ...(job.status === 'error' ? { error: job.error } : {}),
    ...(job.status === 'running'
      ? { note: 'Volume extraction meshes the whole model first; this can take minutes on a cold model. Poll ifc_volumes_result.' }
      : {}),
  };
}
