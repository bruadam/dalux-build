import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

import * as taskIndex from '../src/tools/taskIndex';
import { paragraph, writeDocx } from './fixtures/office';

interface FakeTask {
  taskId: string;
  subject: string;
  usage?: string;
  status?: string;
}

interface FakeChange {
  taskId: string;
  description: string;
  timestamp: string;
  action?: string;
}

interface FakeAttachment {
  taskId: string;
  mediaFile: { name: string; fileDownload: string };
}

function fakeClient(
  tasksList: FakeTask[],
  changes: FakeChange[] = [],
  attachments: FakeAttachment[] = [],
  downloadFileFromLink: jest.Mock = jest.fn(),
) {
  const getProjectTasks = jest.fn(async (_projectId: string, _params: Record<string, unknown>) => ({
    items: tasksList.map((task) => ({ data: { ...task } })),
    metadata: { totalRemainingItems: 0 },
  }));
  const getProjectTaskChanges = jest.fn(async () => ({
    items: changes,
    metadata: { totalRemainingItems: 0 },
  }));
  const getProjectTaskAttachments = jest.fn(async () => ({
    items: attachments,
    metadata: { totalRemainingItems: 0 },
  }));

  const client = {
    tasks: { getProjectTasks, getProjectTaskChanges, getProjectTaskAttachments },
    files: { downloadFileFromLink },
  };
  return {
    client: client as unknown as DaluxClient,
    getProjectTasks,
    getProjectTaskChanges,
    getProjectTaskAttachments,
    downloadFileFromLink,
  };
}

describe('task index', () => {
  let cache: string;
  let originalCacheDir: string | undefined;
  let originalKey: string | undefined;

  beforeAll(() => {
    cache = mkdtempSync(path.join(tmpdir(), 'dalux-task-cache-'));
    originalCacheDir = process.env.DALUX_MCP_CACHE_DIR;
    process.env.DALUX_MCP_CACHE_DIR = cache;
    // Ranking must be deterministic: no key means BM25, no network.
    originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterAll(() => {
    if (originalCacheDir === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
    else process.env.DALUX_MCP_CACHE_DIR = originalCacheDir;
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    rmSync(cache, { recursive: true, force: true });
  });

  const scopeArgs = { projectId: 'p1' };

  it('builds an index combining each task with its change history', async () => {
    const { client } = fakeClient(
      [
        { taskId: 't1', subject: 'Crack in beam B12', usage: 'safetyissue' },
        { taskId: 't2', subject: 'Order more concrete', usage: 'task' },
      ],
      [{ taskId: 't1', description: 'Structural engineer flagged the crack as non-critical', timestamp: '2026-01-02', action: 'update' }],
    );

    const report = await taskIndex.buildTaskIndex(client, scopeArgs);

    expect(report.mode).toBe('lexical');
    expect(report.taskCount).toBe(2);
    expect(report.tasksIndexed).toBe(2);
    expect(report.changeCount).toBe(1);
    expect(report.totalChunks).toBeGreaterThan(0);
  });

  it('searches across tasks and cites the task and location of each passage', async () => {
    const { client } = fakeClient(
      [
        { taskId: 't1', subject: 'Crack in beam B12', usage: 'safetyissue' },
        { taskId: 't2', subject: 'Order more concrete', usage: 'task' },
      ],
      [{ taskId: 't1', description: 'Structural engineer flagged the crack as non-critical', timestamp: '2026-01-02', action: 'update' }],
    );
    await taskIndex.buildTaskIndex(client, scopeArgs);

    const result = await taskIndex.searchTaskIndex(client, { ...scopeArgs, query: 'crack structural engineer' });

    expect(result.mode).toBe('lexical');
    expect(result.tasksSearched).toBe(2);
    expect(result.matches[0].taskId).toBe('t1');
    expect(result.matches[0].subject).toBe('Crack in beam B12');

    const noMatch = await taskIndex.searchTaskIndex(client, { ...scopeArgs, query: 'nothing relevant here at all' });
    expect(noMatch.matches).toEqual([]);
  });

  it('re-indexes only tasks whose fields or change history changed', async () => {
    const tasksList: FakeTask[] = [
      { taskId: 't1', subject: 'Crack in beam B12' },
      { taskId: 't2', subject: 'Order more concrete' },
    ];
    const first = fakeClient(tasksList);
    await taskIndex.buildTaskIndex(first.client, { ...scopeArgs, projectId: 'p-reuse' });

    const unchanged = fakeClient(tasksList);
    const reused = await taskIndex.buildTaskIndex(unchanged.client, { ...scopeArgs, projectId: 'p-reuse' });
    expect(reused.tasksIndexed).toBe(0);
    expect(reused.tasksReused).toBe(2);

    const revised = fakeClient([{ taskId: 't1', subject: 'Crack in beam B12 — widened' }, tasksList[1]]);
    const report = await taskIndex.buildTaskIndex(revised.client, { ...scopeArgs, projectId: 'p-reuse' });
    expect(report.tasksIndexed).toBe(1);
    expect(report.tasksReused).toBe(1);
  });

  it('drops tasks that no longer exist on the project', async () => {
    const full = fakeClient([
      { taskId: 't1', subject: 'Crack in beam B12' },
      { taskId: 't2', subject: 'Order more concrete' },
    ]);
    await taskIndex.buildTaskIndex(full.client, { ...scopeArgs, projectId: 'p-remove' });

    const reduced = fakeClient([{ taskId: 't2', subject: 'Order more concrete' }]);
    const report = await taskIndex.buildTaskIndex(reduced.client, { ...scopeArgs, projectId: 'p-remove' });

    expect(report.tasksRemoved).toBe(1);
    const result = await taskIndex.searchTaskIndex(reduced.client, {
      projectId: 'p-remove',
      query: 'crack beam',
    });
    expect(result.matches).toEqual([]);
    expect(result.tasksSearched).toBe(1);
  });

  it('expands typeId into an OData filter, same as list_project_tasks', async () => {
    const { client, getProjectTasks } = fakeClient([{ taskId: 't1', subject: 'Inspection' }]);

    await taskIndex.buildTaskIndex(client, { projectId: 'p-type', typeId: "ty'1" });

    expect(getProjectTasks).toHaveBeenCalledWith('p-type', { $filter: "data/type/typeId eq 'ty''1'" });
  });

  it('lists and drops indexes without touching Dalux', async () => {
    const { client } = fakeClient([{ taskId: 't1', subject: 'Crack in beam B12' }]);
    const built = await taskIndex.buildTaskIndex(client, { projectId: 'p-drop' });

    const listed = await taskIndex.listTaskIndexes();
    expect(listed.indexes.some((index) => index.indexId === built.indexId)).toBe(true);

    expect(await taskIndex.dropTaskIndex(client, { indexId: built.indexId })).toMatchObject({ dropped: true });
    expect(await taskIndex.dropTaskIndex(client, { indexId: built.indexId })).toMatchObject({ dropped: false });
    await expect(taskIndex.searchTaskIndex(client, { indexId: built.indexId, query: 'anything' })).rejects.toThrow(
      /build_task_index/,
    );
  });

  it('downloads and extracts attachment text into a task\'s chunks', async () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), 'dalux-task-attachment-'));
    const docxPath = writeDocx(fixtureDir, 'report.docx', paragraph('Copper pipe corrosion assessment for riser B12'));
    const downloadFileFromLink = jest.fn(async () => docxPath);

    const { client, getProjectTaskAttachments } = fakeClient(
      [{ taskId: 't1', subject: 'Plumbing inspection' }],
      [],
      [{ taskId: 't1', mediaFile: { name: 'report.docx', fileDownload: 'https://example.invalid/report.docx' } }],
      downloadFileFromLink,
    );

    const report = await taskIndex.buildTaskIndex(client, { projectId: 'p-attach' });
    expect(getProjectTaskAttachments).toHaveBeenCalled();
    expect(report.attachmentCount).toBe(1);
    expect(downloadFileFromLink).toHaveBeenCalledWith(
      'https://example.invalid/report.docx',
      'report.docx',
      expect.any(String),
    );

    const result = await taskIndex.searchTaskIndex(client, { projectId: 'p-attach', query: 'copper pipe corrosion' });
    expect(result.matches[0]?.taskId).toBe('t1');

    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('reuses a task\'s cached chunks (no re-download) when its attachment list is unchanged', async () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), 'dalux-task-attachment-'));
    const docxPath = writeDocx(fixtureDir, 'report.docx', paragraph('Copper pipe corrosion assessment'));
    const attachments: FakeAttachment[] = [
      { taskId: 't1', mediaFile: { name: 'report.docx', fileDownload: 'https://example.invalid/report.docx' } },
    ];
    const tasksList: FakeTask[] = [{ taskId: 't1', subject: 'Plumbing inspection' }];

    const first = fakeClient(tasksList, [], attachments, jest.fn(async () => docxPath));
    await taskIndex.buildTaskIndex(first.client, { projectId: 'p-attach-reuse' });
    expect(first.downloadFileFromLink).toHaveBeenCalledTimes(1);

    const second = fakeClient(tasksList, [], attachments, jest.fn(async () => docxPath));
    const reused = await taskIndex.buildTaskIndex(second.client, { projectId: 'p-attach-reuse' });
    expect(reused.tasksIndexed).toBe(0);
    expect(second.downloadFileFromLink).not.toHaveBeenCalled();

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
