import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

let cacheDir: string;
jest.mock('../src/cachePaths', () => ({
  cacheDirFor: jest.fn(() => cacheDir),
}));

import * as tasks from '../src/tools/tasks';
import { paragraph, writeDocx } from './fixtures/office';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/tasks', () => {
  beforeAll(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-tasks-'));
  });

  afterAll(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('listProjectTasks forwards filters and returns all Dalux-paginated items', async () => {
    const getProjectTasks = jest.fn().mockResolvedValue({ items: [{ taskId: 't1' }, { taskId: 't2' }] });
    const client = fakeClient({ tasks: { getProjectTasks } });

    const result = await tasks.listProjectTasks(client, {
      projectId: 'p1',
      typeId: 'ty1',
    });

    expect(getProjectTasks).toHaveBeenCalledWith('p1', { typeId: 'ty1' });
    expect(result.items).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.returnedCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('listProjectTasks translates filter/select/orderby to their OData $-prefixed names', async () => {
    const getProjectTasks = jest.fn().mockResolvedValue({ items: [] });
    const client = fakeClient({ tasks: { getProjectTasks } });

    await tasks.listProjectTasks(client, {
      projectId: 'p1',
      filter: "data/type/typeId eq 'x'",
      select: 'taskId,title',
      orderby: 'taskId desc',
    });

    expect(getProjectTasks).toHaveBeenCalledWith('p1', {
      $filter: "data/type/typeId eq 'x'",
      $select: 'taskId,title',
      $orderby: 'taskId desc',
    });
  });

  it('listProjectTasks applies field conditions client-side (date range, ANDed)', async () => {
    const getProjectTasks = jest.fn().mockResolvedValue({
      items: [
        { taskId: 't1', created: '2026-07-15T00:00:00Z' },
        { taskId: 't2', created: '2026-08-10T00:00:00Z' },
        { taskId: 't3', created: '2026-09-01T00:00:00Z' },
      ],
    });
    const client = fakeClient({ tasks: { getProjectTasks } });

    const result = await tasks.listProjectTasks(client, {
      projectId: 'p1',
      conditions: [
        { field: 'created', op: 'ge', value: '2026-08-01T00:00:00Z' },
        { field: 'created', op: 'lt', value: '2026-09-01T00:00:00Z' },
      ],
    });

    expect(getProjectTasks).toHaveBeenCalledWith('p1', {});
    expect(result.items).toEqual([{ taskId: 't2', created: '2026-08-10T00:00:00Z' }]);
  });

  it('listProjectTasks applies conditions against nested fields and "contains"', async () => {
    const getProjectTasks = jest.fn().mockResolvedValue({
      items: [
        { taskId: 't1', type: { typeId: 'ty1' }, subject: 'Teknisk forespørgsel om fundament' },
        { taskId: 't2', type: { typeId: 'ty2' }, subject: 'Teknisk forespørgsel om tag' },
      ],
    });
    const client = fakeClient({ tasks: { getProjectTasks } });

    const result = await tasks.listProjectTasks(client, {
      projectId: 'p1',
      conditions: [
        { field: 'type.typeId', op: 'eq', value: 'ty1' },
        { field: 'subject', op: 'contains', value: 'fundament' },
      ],
    });

    expect(result.items).toEqual([{ taskId: 't1', type: { typeId: 'ty1' }, subject: 'Teknisk forespørgsel om fundament' }]);
  });

  it('getTask forwards to TasksApi.getTask', async () => {
    const getTask = jest.fn().mockResolvedValue({ taskId: 't1' });
    const client = fakeClient({ tasks: { getTask } });

    const result = await tasks.getTask(client, { projectId: 'p1', taskId: 't1' });

    expect(getTask).toHaveBeenCalledWith('p1', 't1');
    expect(result).toEqual({ taskId: 't1' });
  });

  it('listTaskChanges returns all Dalux-paginated items', async () => {
    const getProjectTaskChanges = jest.fn().mockResolvedValue({ items: [{ changeId: 'c1' }, { changeId: 'c2' }] });
    const client = fakeClient({ tasks: { getProjectTaskChanges } });

    const result = await tasks.listTaskChanges(client, { projectId: 'p1', updatedAfter: '2026-01-01' });

    expect(getProjectTaskChanges).toHaveBeenCalledWith('p1', { updatedAfter: '2026-01-01' });
    expect(result.items).toHaveLength(2);
    expect(result.returnedCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('listTaskChanges filters to taskId client-side after fetching the full window', async () => {
    const getProjectTaskChanges = jest.fn().mockResolvedValue({
      items: [
        { taskId: 't1', changeId: 'c1' },
        { taskId: 't2', changeId: 'c2' },
      ],
    });
    const client = fakeClient({ tasks: { getProjectTaskChanges } });

    const result = await tasks.listTaskChanges(client, { projectId: 'p1', taskId: 't1' });

    expect(getProjectTaskChanges).toHaveBeenCalledWith('p1', {});
    expect(result.items).toEqual([{ taskId: 't1', changeId: 'c1' }]);
    expect(result.totalCount).toBe(1);
  });

  it('listTaskAttachments unwraps the items envelope from getProjectTaskAttachments', async () => {
    const getProjectTaskAttachments = jest.fn().mockResolvedValue({ items: [{ attachmentId: 'a1' }] });
    const client = fakeClient({ tasks: { getProjectTaskAttachments } });

    const result = await tasks.listTaskAttachments(client, { projectId: 'p1' });

    expect(getProjectTaskAttachments).toHaveBeenCalledWith('p1', {});
    expect(result.items).toEqual([{ attachmentId: 'a1' }]);
    expect(result.truncated).toBe(false);
  });

  it('listTaskAttachments follows Dalux bookmark pages to completion', async () => {
    const getProjectTaskAttachments = jest
      .fn()
      .mockResolvedValueOnce({
        items: [{ attachmentId: 'a1' }],
        metadata: { totalRemainingItems: 1 },
        links: [{ rel: 'nextPage', href: 'https://example.invalid/att?bookmark=b1' }],
      })
      .mockResolvedValueOnce({
        items: [{ attachmentId: 'a2' }],
        metadata: { totalRemainingItems: 0 },
        links: [],
      });
    const client = fakeClient({ tasks: { getProjectTaskAttachments } });

    const result = await tasks.listTaskAttachments(client, { projectId: 'p1' });

    expect(getProjectTaskAttachments).toHaveBeenNthCalledWith(1, 'p1', {});
    expect(getProjectTaskAttachments).toHaveBeenNthCalledWith(2, 'p1', { bookmark: 'b1' });
    expect(result.items).toEqual([{ attachmentId: 'a1' }, { attachmentId: 'a2' }]);
    expect(result.returnedCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('searchTasks ranks tasks against the query and skips fetching changes by default', async () => {
    const getProjectTasks = jest.fn().mockResolvedValue({
      items: [
        { data: { taskId: 't1', subject: 'Crack in beam B12', usage: 'safetyissue' } },
        { data: { taskId: 't2', subject: 'Order more concrete', usage: 'task' } },
      ],
    });
    const getProjectTaskChanges = jest.fn();
    const client = fakeClient({ tasks: { getProjectTasks, getProjectTaskChanges } });

    const result = await tasks.searchTasks(client, { projectId: 'p1', query: 'crack in the beam' });

    expect(getProjectTasks).toHaveBeenCalledWith('p1', {});
    expect(getProjectTaskChanges).not.toHaveBeenCalled();
    expect(result.totalTasks).toBe(2);
    expect(result.matches[0]).toMatchObject({ taskId: 't1', subject: 'Crack in beam B12' });
  });

  it('searchTasks applies field conditions client-side before ranking', async () => {
    const getProjectTasks = jest.fn().mockResolvedValue({
      items: [
        { data: { taskId: 't1', subject: 'Teknisk forespørgsel om fundament', created: '2026-07-15T00:00:00Z' } },
        { data: { taskId: 't2', subject: 'Teknisk forespørgsel om tag', created: '2026-08-10T00:00:00Z' } },
      ],
    });
    const client = fakeClient({ tasks: { getProjectTasks } });

    const result = await tasks.searchTasks(client, {
      projectId: 'p1',
      query: 'Teknisk forespørgsel',
      conditions: [{ field: 'created', op: 'ge', value: '2026-08-01T00:00:00Z' }],
    });

    expect(getProjectTasks).toHaveBeenCalledWith('p1', {});
    expect(result.totalTasks).toBe(1);
    expect(result.matches[0]).toMatchObject({ taskId: 't2' });
  });

  it('searchTasks expands typeId into an OData filter and includes change text when asked', async () => {
    const getProjectTasks = jest.fn().mockResolvedValue({
      items: [{ data: { taskId: 't1', subject: 'Inspection' } }],
    });
    const getProjectTaskChanges = jest.fn().mockResolvedValue({
      items: [{ taskId: 't1', description: 'Reassigned after a plumbing leak was reported', timestamp: '2026-01-02', action: 'update' }],
    });
    const client = fakeClient({ tasks: { getProjectTasks, getProjectTaskChanges } });

    const result = await tasks.searchTasks(client, {
      projectId: 'p1',
      query: 'plumbing leak',
      typeId: 'ty1',
      includeChanges: true,
    });

    expect(getProjectTasks).toHaveBeenCalledWith('p1', { $filter: "data/type/typeId eq 'ty1'" });
    expect(getProjectTaskChanges).toHaveBeenCalledWith('p1', {});
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].taskId).toBe('t1');
  });

  it('searchTasks downloads and matches against attachment text when includeAttachments is set', async () => {
    const docxPath = writeDocx(cacheDir, 'report.docx', paragraph('Copper pipe corrosion assessment for riser B12'));
    const getProjectTasks = jest.fn().mockResolvedValue({
      items: [
        { data: { taskId: 't1', subject: 'Plumbing inspection' } },
        { data: { taskId: 't2', subject: 'Electrical inspection' } },
      ],
    });
    const getProjectTaskAttachments = jest.fn().mockResolvedValue({
      items: [{ taskId: 't1', mediaFile: { name: 'report.docx', fileDownload: 'https://example.invalid/report.docx' } }],
    });
    const downloadFileFromLink = jest.fn().mockResolvedValue(docxPath);
    const client = fakeClient({
      tasks: { getProjectTasks, getProjectTaskAttachments },
      files: { downloadFileFromLink },
    });

    const result = await tasks.searchTasks(client, {
      projectId: 'p1',
      query: 'copper pipe corrosion',
      includeAttachments: true,
    });

    expect(getProjectTaskAttachments).toHaveBeenCalledWith('p1', {});
    expect(downloadFileFromLink).toHaveBeenCalledWith('https://example.invalid/report.docx', 'report.docx', cacheDir);
    expect(result.matches[0]?.taskId).toBe('t1');
  });

  it('searchTasks does not fetch attachments unless asked', async () => {
    const getProjectTasks = jest.fn().mockResolvedValue({ items: [{ data: { taskId: 't1', subject: 'Inspection' } }] });
    const getProjectTaskAttachments = jest.fn();
    const client = fakeClient({ tasks: { getProjectTasks, getProjectTaskAttachments } });

    await tasks.searchTasks(client, { projectId: 'p1', query: 'inspection' });

    expect(getProjectTaskAttachments).not.toHaveBeenCalled();
  });

  it('listTaskAttachments tolerates a missing items envelope', async () => {
    const getProjectTaskAttachments = jest.fn().mockResolvedValue(null);
    const client = fakeClient({ tasks: { getProjectTaskAttachments } });

    const result = await tasks.listTaskAttachments(client, { projectId: 'p1' });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('listTaskAttachments truncates to `limit` (default 50) so a large project can\'t blow the response', async () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ taskId: `t${i}`, attachmentId: `a${i}` }));
    const getProjectTaskAttachments = jest.fn().mockResolvedValue({ items });
    const client = fakeClient({ tasks: { getProjectTaskAttachments } });

    const defaultResult = await tasks.listTaskAttachments(client, { projectId: 'p1' });
    expect(defaultResult.returnedCount).toBe(50);
    expect(defaultResult.totalCount).toBe(120);
    expect(defaultResult.truncated).toBe(true);

    const limited = await tasks.listTaskAttachments(client, { projectId: 'p1', limit: 10 });
    expect(limited.returnedCount).toBe(10);
    expect(limited.items[0]).toEqual({ taskId: 't0', attachmentId: 'a0' });
  });

  it('listTaskChanges truncates to `limit` (default 50) so a large project can\'t blow the response', async () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ taskId: `t${i}`, changeId: `c${i}` }));
    const getProjectTaskChanges = jest.fn().mockResolvedValue({ items });
    const client = fakeClient({ tasks: { getProjectTaskChanges } });

    const result = await tasks.listTaskChanges(client, { projectId: 'p1' });

    expect(result.returnedCount).toBe(50);
    expect(result.totalCount).toBe(80);
    expect(result.truncated).toBe(true);
  });

  it('listTaskAttachments filters to taskId client-side after fetching the full window', async () => {
    const getProjectTaskAttachments = jest.fn().mockResolvedValue({
      items: [
        { taskId: 't1', attachmentId: 'a1' },
        { taskId: 't2', attachmentId: 'a2' },
      ],
    });
    const client = fakeClient({ tasks: { getProjectTaskAttachments } });

    const result = await tasks.listTaskAttachments(client, { projectId: 'p1', taskId: 't1' });

    expect(getProjectTaskAttachments).toHaveBeenCalledWith('p1', {});
    expect(result.items).toEqual([{ taskId: 't1', attachmentId: 'a1' }]);
  });

  it('getTask does not fetch changes/attachments unless asked', async () => {
    const getTask = jest.fn().mockResolvedValue({ data: { taskId: 't1' } });
    const getProjectTaskChanges = jest.fn();
    const getProjectTaskAttachments = jest.fn();
    const client = fakeClient({ tasks: { getTask, getProjectTaskChanges, getProjectTaskAttachments } });

    const result = await tasks.getTask(client, { projectId: 'p1', taskId: 't1' });

    expect(result).toEqual({ data: { taskId: 't1' } });
    expect(getProjectTaskChanges).not.toHaveBeenCalled();
    expect(getProjectTaskAttachments).not.toHaveBeenCalled();
  });

  it('getTask merges in this task\'s changes and attachments when asked, filtered client-side', async () => {
    const getTask = jest.fn().mockResolvedValue({ data: { taskId: 't1', subject: 'Crack in beam' } });
    const getProjectTaskChanges = jest.fn().mockResolvedValue({
      items: [
        { taskId: 't1', description: 'Marked resolved', timestamp: '2026-01-02', action: 'comment' },
        { taskId: 't2', description: 'Unrelated', timestamp: '2026-01-02', action: 'comment' },
      ],
    });
    const getProjectTaskAttachments = jest.fn().mockResolvedValue({
      items: [
        { taskId: 't1', attachmentId: 'a1' },
        { taskId: 't2', attachmentId: 'a2' },
      ],
    });
    const client = fakeClient({ tasks: { getTask, getProjectTaskChanges, getProjectTaskAttachments } });

    const result = (await tasks.getTask(client, {
      projectId: 'p1',
      taskId: 't1',
      includeChanges: true,
      includeAttachments: true,
    })) as Record<string, unknown>;

    expect(getProjectTaskChanges).toHaveBeenCalledWith('p1', {});
    expect(getProjectTaskAttachments).toHaveBeenCalledWith('p1', {});
    expect(result.data).toEqual({ taskId: 't1', subject: 'Crack in beam' });
    expect(result.changes).toEqual([
      { taskId: 't1', description: 'Marked resolved', timestamp: '2026-01-02', action: 'comment' },
    ]);
    expect(result.attachments).toEqual([{ taskId: 't1', attachmentId: 'a1' }]);
  });

  it('downloadTaskAttachment signs the mediaFile.fileDownload URL via FilesApi and reports the saved path', async () => {
    const downloadFileFromLink = jest.fn().mockResolvedValue(`${cacheDir}/KP Test.docx`);
    const client = fakeClient({ files: { downloadFileFromLink } });

    const result = await tasks.downloadTaskAttachment(client, {
      fileDownload:
        'https://node1.field.dalux.com/service/FieldBinaryStore/web/Project/1/TaskAttachment/2/Token/abc/KP_Test.docx',
      fileName: 'KP Test.docx',
    });

    expect(downloadFileFromLink).toHaveBeenCalledWith(
      'https://node1.field.dalux.com/service/FieldBinaryStore/web/Project/1/TaskAttachment/2/Token/abc/KP_Test.docx',
      'KP Test.docx',
      cacheDir,
    );
    expect(result).toEqual({ found: true, filePath: `${cacheDir}/KP Test.docx`, fileName: 'KP Test.docx' });
  });

  it('downloadTaskAttachment falls back to the URL\'s last path segment when fileName is omitted', async () => {
    const downloadFileFromLink = jest.fn().mockResolvedValue(`${cacheDir}/IMG_9740.JPG`);
    const client = fakeClient({ files: { downloadFileFromLink } });

    const result = await tasks.downloadTaskAttachment(client, {
      fileDownload: 'https://node1.field.dalux.com/service/FieldBinaryStore/web/Project/1/TaskAttachment/2/Token/abc/IMG_9740.JPG',
    });

    expect(downloadFileFromLink).toHaveBeenCalledWith(
      'https://node1.field.dalux.com/service/FieldBinaryStore/web/Project/1/TaskAttachment/2/Token/abc/IMG_9740.JPG',
      'IMG_9740.JPG',
      cacheDir,
    );
    expect(result.fileName).toBe('IMG_9740.JPG');
  });

  describe('downloadTaskAttachmentToChat', () => {
    it('inlines the attachment content as a base64 resource alongside the cached path', async () => {
      const filePath = `${cacheDir}/KP Test.docx`;
      writeFileSync(filePath, 'docx bytes');
      const downloadFileFromLink = jest.fn().mockResolvedValue(filePath);
      const client = fakeClient({ files: { downloadFileFromLink } });

      const result = (await tasks.downloadTaskAttachmentToChat(client, {
        fileDownload:
          'https://node1.field.dalux.com/service/FieldBinaryStore/web/Project/1/TaskAttachment/2/Token/abc/KP_Test.docx',
        fileName: 'KP Test.docx',
      })) as Record<string, unknown>;

      expect(result).toMatchObject({ found: true, filePath, fileName: 'KP Test.docx', size: 10 });
      const resource = result.resource as { mimeType: string; blob: string };
      expect(resource.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(Buffer.from(resource.blob, 'base64').toString()).toBe('docx bytes');
    });

    it('falls back to a message instead of a resource when the attachment is over the inline limit', async () => {
      const originalLimit = process.env.DALUX_MCP_MAX_INLINE_BYTES;
      process.env.DALUX_MCP_MAX_INLINE_BYTES = '4';
      try {
        const filePath = `${cacheDir}/IMG_9740.JPG`;
        writeFileSync(filePath, 'more than four bytes');
        const downloadFileFromLink = jest.fn().mockResolvedValue(filePath);
        const client = fakeClient({ files: { downloadFileFromLink } });

        const result = (await tasks.downloadTaskAttachmentToChat(client, {
          fileDownload:
            'https://node1.field.dalux.com/service/FieldBinaryStore/web/Project/1/TaskAttachment/2/Token/abc/IMG_9740.JPG',
        })) as Record<string, unknown>;

        expect(result.resource).toBeUndefined();
        expect(result).toMatchObject({ found: true, filePath, fileName: 'IMG_9740.JPG' });
        expect(result.message).toContain('inline limit');
      } finally {
        if (originalLimit === undefined) delete process.env.DALUX_MCP_MAX_INLINE_BYTES;
        else process.env.DALUX_MCP_MAX_INLINE_BYTES = originalLimit;
      }
    });

    it('honours a per-call maxInlineBytes above the server-wide default', async () => {
      const originalLimit = process.env.DALUX_MCP_MAX_INLINE_BYTES;
      process.env.DALUX_MCP_MAX_INLINE_BYTES = '4';
      try {
        const filePath = `${cacheDir}/IMG_9741.JPG`;
        writeFileSync(filePath, 'more than four bytes');
        const downloadFileFromLink = jest.fn().mockResolvedValue(filePath);
        const client = fakeClient({ files: { downloadFileFromLink } });

        const result = (await tasks.downloadTaskAttachmentToChat(client, {
          fileDownload:
            'https://node1.field.dalux.com/service/FieldBinaryStore/web/Project/1/TaskAttachment/2/Token/abc/IMG_9741.JPG',
          maxInlineBytes: 1024,
        })) as Record<string, unknown>;

        expect(result.resource).toBeDefined();
        expect(result.message).toBeUndefined();
      } finally {
        if (originalLimit === undefined) delete process.env.DALUX_MCP_MAX_INLINE_BYTES;
        else process.env.DALUX_MCP_MAX_INLINE_BYTES = originalLimit;
      }
    });
  });
});
