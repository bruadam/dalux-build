import type { DaluxClient } from 'dalux-build-api';
import * as scheduling from '../src/tools/scheduling';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/scheduling', () => {
  it('listWorkPackages unwraps the items envelope and paginates', async () => {
    const listWorkPackages = jest.fn().mockResolvedValue({ items: [{ workPackageId: 'wp1' }] });
    const client = fakeClient({ workPackages: { listWorkPackages } });

    const result = await scheduling.listWorkPackages(client, { projectId: 'p1' });

    expect(listWorkPackages).toHaveBeenCalledWith('p1');
    expect(result.items).toEqual([{ workPackageId: 'wp1' }]);
  });

  it('listVersionSets unwraps the items envelope and paginates', async () => {
    const getVersionSets = jest.fn().mockResolvedValue({ items: [{ versionSetId: 'vs1' }] });
    const client = fakeClient({ versionSets: { getVersionSets } });

    const result = await scheduling.listVersionSets(client, { projectId: 'p1' });

    expect(getVersionSets).toHaveBeenCalledWith('p1');
    expect(result.items).toEqual([{ versionSetId: 'vs1' }]);
  });

  it('tolerates a missing items envelope', async () => {
    const listWorkPackages = jest.fn().mockResolvedValue(null);
    const client = fakeClient({ workPackages: { listWorkPackages } });

    const result = await scheduling.listWorkPackages(client, { projectId: 'p1' });

    expect(result.items).toEqual([]);
  });
});
