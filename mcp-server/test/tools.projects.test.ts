import type { DaluxClient } from 'dalux-build-api';
import * as projects from '../src/tools/projects';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

describe('tools/projects', () => {
  it('listProjects unwraps the items envelope and paginates', async () => {
    const allProjects = Array.from({ length: 55 }, (_, i) => ({ projectId: `p${i}` }));
    const listProjects = jest.fn().mockResolvedValue({ items: allProjects });
    const client = fakeClient({ projects: { listProjects } });

    const result = await projects.listProjects(client, { updatedAfter: '2026-01-01', limit: 20 });

    expect(listProjects).toHaveBeenCalledWith({ updatedAfter: '2026-01-01' });
    expect(result.items).toHaveLength(20);
    expect(result.totalCount).toBe(55);
    expect(result.truncated).toBe(true);
  });

  it('listProjects tolerates a missing items envelope', async () => {
    const listProjects = jest.fn().mockResolvedValue(undefined);
    const client = fakeClient({ projects: { listProjects } });

    const result = await projects.listProjects(client, {});

    expect(result.items).toEqual([]);
  });

  it('getProject forwards to ProjectsApi.getProject', async () => {
    const getProject = jest.fn().mockResolvedValue({ projectId: 'p1' });
    const client = fakeClient({ projects: { getProject } });

    const result = await projects.getProject(client, { projectId: 'p1' });

    expect(getProject).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ projectId: 'p1' });
  });

  it('findProjectByName forwards to ProjectsApi.getProjectByName', async () => {
    const getProjectByName = jest.fn().mockResolvedValue(null);
    const client = fakeClient({ projects: { getProjectByName } });

    const result = await projects.findProjectByName(client, { projectName: 'Acme Tower' });

    expect(getProjectByName).toHaveBeenCalledWith('Acme Tower');
    expect(result).toBeNull();
  });
});
