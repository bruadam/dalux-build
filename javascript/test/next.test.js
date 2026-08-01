'use strict';

const { createBrowserClient, DaluxProxyError } = require('../src/browser');
const { createDaluxRouteHandler } = require('../src/next');

describe('Next.js proxy adapter', () => {
  it('round-trips browser calls through an explicitly allowed server method', async () => {
    const serverClient = {
      projects: { listProjects: jest.fn(async (params) => [{ projectId: params.id }]) },
    };
    const POST = createDaluxRouteHandler({
      client: serverClient,
      allowedMethods: { projects: ['listProjects'] },
    });
    const browserClient = createBrowserClient({
      fetch: (_url, init) => POST(new Request('http://localhost/api/dalux', init)),
    });

    await expect(browserClient.projects.listProjects({ id: 'p1' })).resolves.toEqual([
      { projectId: 'p1' },
    ]);
    expect(serverClient.projects.listProjects).toHaveBeenCalledWith({ id: 'p1' });
  });

  it('does not expose methods outside the allow-list', async () => {
    const POST = createDaluxRouteHandler({
      client: { projects: { listProjects: async () => [], createProject: async () => ({}) } },
      allowedMethods: ['projects.listProjects'],
    });
    const browserClient = createBrowserClient({
      fetch: (_url, init) => POST(new Request('http://localhost/api/dalux', init)),
    });

    await expect(browserClient.projects.createProject({ name: 'unsafe' })).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
    });
  });

  it('supports application authorization', async () => {
    const POST = createDaluxRouteHandler({
      client: { projects: { listProjects: async () => [] } },
      allowedMethods: ['projects.listProjects'],
      authorize: () => false,
    });
    const response = await POST(new Request('http://localhost/api/dalux', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'projects', method: 'listProjects', args: [] }),
    }));
    expect(response.status).toBe(401);
  });

  it('maps non-JSON proxy responses to DaluxProxyError', async () => {
    const browserClient = createBrowserClient({
      fetch: async () => new Response('bad gateway', { status: 502 }),
    });
    await expect(browserClient.projects.listProjects()).rejects.toBeInstanceOf(DaluxProxyError);
  });

  it('requires an explicit method allow-list', () => {
    expect(() => createDaluxRouteHandler({ client: {} })).toThrow('allowedMethods');
  });
});
