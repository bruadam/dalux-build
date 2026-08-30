import type { DaluxClient } from 'dalux-build-api';
import * as directory from '../src/tools/directory';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/directory', () => {
  it('listProjectUsers unwraps the items envelope and paginates', async () => {
    const listProjectUsers = jest.fn().mockResolvedValue({ items: [{ userId: 'u1' }, { userId: 'u2' }] });
    const client = fakeClient({ users: { listProjectUsers } });

    const result = await directory.listProjectUsers(client, { projectId: 'p1', limit: 1 });

    expect(listProjectUsers).toHaveBeenCalledWith('p1');
    expect(result.items).toEqual([{ userId: 'u1' }]);
    expect(result.truncated).toBe(true);
  });

  it('getUser forwards to UsersApi.getProjectUser', async () => {
    const getProjectUser = jest.fn().mockResolvedValue({ userId: 'u1' });
    const client = fakeClient({ users: { getProjectUser } });

    const result = await directory.getUser(client, { projectId: 'p1', userId: 'u1' });

    expect(getProjectUser).toHaveBeenCalledWith('p1', 'u1');
    expect(result).toEqual({ userId: 'u1' });
  });

  it('listProjectCompanies unwraps the items envelope and paginates', async () => {
    const listProjectCompanies = jest.fn().mockResolvedValue({ items: [{ companyId: 'c1' }] });
    const client = fakeClient({ companies: { listProjectCompanies } });

    const result = await directory.listProjectCompanies(client, { projectId: 'p1' });

    expect(listProjectCompanies).toHaveBeenCalledWith('p1');
    expect(result.items).toEqual([{ companyId: 'c1' }]);
  });
});
