import type { DaluxClient } from 'dalux-build-api';
import * as tasks from '../src/tools/tasks';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/tasks', () => {
  it('listProjectTasks forwards filters and returns the default 50-item MCP page', async () => {
    const firstPage = {
      items: Array.from({ length: 100 }, (_, i) => ({ taskId: `t${i}` })),
      metadata: { totalItems: 220, totalRemainingItems: 120 },
      links: [{ rel: 'nextPage', href: 'https://example.invalid/tasks?bookmark=b1' }],
    };
    const getProjectTasks = jest
      .fn()
      .mockResolvedValueOnce(firstPage);
    const client = fakeClient({ tasks: { getProjectTasks } });

    const result = await tasks.listProjectTasks(client, {
      projectId: 'p1',
      typeId: 'ty1',
    });

    expect(getProjectTasks).toHaveBeenCalledWith('p1', { typeId: 'ty1' });
    expect(getProjectTasks).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(50);
    expect(result.totalCount).toBe(220);
    expect(result.truncated).toBe(true);
  });

  it('listProjectTasks translates filter/select/orderby to their OData $-prefixed names', async () => {
    const getProjectTasks = jest.fn().mockResolvedValue({ items: [], links: [], metadata: { totalItems: 0 } });
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

  it('listProjectTasks avoids infinite loops when nextPage repeats a bookmark', async () => {
    const getProjectTasks = jest
      .fn()
      .mockResolvedValueOnce({
        items: [{ taskId: 't1' }],
        metadata: { totalItems: 100, totalRemainingItems: 99 },
        links: [{ rel: 'nextPage', href: 'https://example.invalid/tasks?bookmark=repeat' }],
      })
      .mockResolvedValueOnce({
        items: [{ taskId: 't2' }],
        metadata: { totalItems: 100, totalRemainingItems: 98 },
        links: [{ rel: 'nextPage', href: 'https://example.invalid/tasks?bookmark=repeat' }],
      });
    const client = fakeClient({ tasks: { getProjectTasks } });

    const result = await tasks.listProjectTasks(client, { projectId: 'p1' });

    expect(getProjectTasks).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual([{ taskId: 't1' }, { taskId: 't2' }]);
    expect(result.totalCount).toBe(100);
  });

  it('getTask forwards to TasksApi.getTask', async () => {
    const getTask = jest.fn().mockResolvedValue({ taskId: 't1' });
    const client = fakeClient({ tasks: { getTask } });

    const result = await tasks.getTask(client, { projectId: 'p1', taskId: 't1' });

    expect(getTask).toHaveBeenCalledWith('p1', 't1');
    expect(result).toEqual({ taskId: 't1' });
  });

  it('listTaskChanges paginates the getAllProjectTaskChanges result', async () => {
    const changes = Array.from({ length: 3 }, (_, i) => ({ changeId: `c${i}` }));
    const getAllProjectTaskChanges = jest.fn().mockResolvedValue(changes);
    const client = fakeClient({ tasks: { getAllProjectTaskChanges } });

    const result = await tasks.listTaskChanges(client, { projectId: 'p1', updatedAfter: '2026-01-01' });

    expect(getAllProjectTaskChanges).toHaveBeenCalledWith('p1', { updatedAfter: '2026-01-01' });
    expect(result.items).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it('listTaskAttachments unwraps the items envelope from getProjectTaskAttachments', async () => {
    const getProjectTaskAttachments = jest.fn().mockResolvedValue({ items: [{ attachmentId: 'a1' }] });
    const client = fakeClient({ tasks: { getProjectTaskAttachments } });

    const result = await tasks.listTaskAttachments(client, { projectId: 'p1' });

    expect(getProjectTaskAttachments).toHaveBeenCalledWith('p1', {});
    expect(result.items).toEqual([{ attachmentId: 'a1' }]);
  });

  it('listTaskAttachments tolerates a missing items envelope', async () => {
    const getProjectTaskAttachments = jest.fn().mockResolvedValue(null);
    const client = fakeClient({ tasks: { getProjectTaskAttachments } });

    const result = await tasks.listTaskAttachments(client, { projectId: 'p1' });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});
