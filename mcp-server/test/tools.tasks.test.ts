import type { DaluxClient } from 'dalux-build-api';
import * as tasks from '../src/tools/tasks';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/tasks', () => {
  it('listProjectTasks forwards filters and returns all Dalux-paginated items', async () => {
    const allTasks = Array.from({ length: 220 }, (_, i) => ({ taskId: `t${i}` }));
    const getAllProjectTasks = jest.fn().mockResolvedValue(allTasks);
    const client = fakeClient({ tasks: { getAllProjectTasks } });

    const result = await tasks.listProjectTasks(client, {
      projectId: 'p1',
      typeId: 'ty1',
    });

    expect(getAllProjectTasks).toHaveBeenCalledWith('p1', { typeId: 'ty1' });
    expect(result.items).toHaveLength(220);
    expect(result.totalCount).toBe(220);
    expect(result.returnedCount).toBe(220);
    expect(result.truncated).toBe(false);
  });

  it('listProjectTasks translates filter/select/orderby to their OData $-prefixed names', async () => {
    const getAllProjectTasks = jest.fn().mockResolvedValue([]);
    const client = fakeClient({ tasks: { getAllProjectTasks } });

    await tasks.listProjectTasks(client, {
      projectId: 'p1',
      filter: "data/type/typeId eq 'x'",
      select: 'taskId,title',
      orderby: 'taskId desc',
    });

    expect(getAllProjectTasks).toHaveBeenCalledWith('p1', {
      $filter: "data/type/typeId eq 'x'",
      $select: 'taskId,title',
      $orderby: 'taskId desc',
    });
  });

  it('getTask forwards to TasksApi.getTask', async () => {
    const getTask = jest.fn().mockResolvedValue({ taskId: 't1' });
    const client = fakeClient({ tasks: { getTask } });

    const result = await tasks.getTask(client, { projectId: 'p1', taskId: 't1' });

    expect(getTask).toHaveBeenCalledWith('p1', 't1');
    expect(result).toEqual({ taskId: 't1' });
  });

  it('listTaskChanges returns all Dalux-paginated items', async () => {
    const changes = Array.from({ length: 3 }, (_, i) => ({ changeId: `c${i}` }));
    const getAllProjectTaskChanges = jest.fn().mockResolvedValue(changes);
    const client = fakeClient({ tasks: { getAllProjectTaskChanges } });

    const result = await tasks.listTaskChanges(client, { projectId: 'p1', updatedAfter: '2026-01-01' });

    expect(getAllProjectTaskChanges).toHaveBeenCalledWith('p1', { updatedAfter: '2026-01-01' });
    expect(result.items).toHaveLength(3);
    expect(result.returnedCount).toBe(3);
    expect(result.truncated).toBe(false);
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

  it('listTaskAttachments tolerates a missing items envelope', async () => {
    const getProjectTaskAttachments = jest.fn().mockResolvedValue(null);
    const client = fakeClient({ tasks: { getProjectTaskAttachments } });

    const result = await tasks.listTaskAttachments(client, { projectId: 'p1' });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});
