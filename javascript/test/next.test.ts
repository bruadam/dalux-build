import { createBrowserClient, DaluxProxyError } from '../src/browser';
import { createDaluxRouteHandler } from '../src/next';

describe('Next.js proxy adapter', () => {
  it('round-trips browser calls through an explicitly allowed server method', async () => {
    const serverClient = {
      projects: { listProjects: jest.fn(async (params: { id: string }) => [{ projectId: params.id }]) },
    };
    const POST = createDaluxRouteHandler({
      client: serverClient,
      allowedMethods: { projects: ['listProjects'] },
    });
    const browserClient = createBrowserClient({
      fetch: ((_url: Parameters<typeof fetch>[0], init?: RequestInit) =>
        POST(new Request('http://localhost/api/dalux', init))) as typeof fetch,
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
      fetch: ((_url: Parameters<typeof fetch>[0], init?: RequestInit) =>
        POST(new Request('http://localhost/api/dalux', init))) as typeof fetch,
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
    const response = await POST(
      new Request('http://localhost/api/dalux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'projects', method: 'listProjects', args: [] }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('maps non-JSON proxy responses to DaluxProxyError', async () => {
    const browserClient = createBrowserClient({
      fetch: (async () => new Response('bad gateway', { status: 502 })) as typeof fetch,
    });
    await expect(browserClient.projects.listProjects()).rejects.toBeInstanceOf(DaluxProxyError);
  });

  it('requires an explicit method allow-list', () => {
    expect(() => createDaluxRouteHandler({ client: {}, allowedMethods: [] })).toThrow('allowedMethods');
  });
});
