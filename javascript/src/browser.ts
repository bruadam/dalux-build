const RESOURCES = [
  'projects',
  'companies',
  'companyCatalog',
  'fileAreas',
  'fileRevisions',
  'fileUpload',
  'files',
  'folders',
  'forms',
  'inspectionPlans',
  'projectTemplates',
  'tasks',
  'testPlans',
  'users',
  'versionSets',
  'workPackages',
] as const;

export type DaluxResourceName = (typeof RESOURCES)[number];

export interface DaluxProxyErrorOptions {
  name?: string;
  status?: number;
  details?: unknown;
}

export class DaluxProxyError extends Error {
  status?: number;
  details?: unknown;

  constructor(message: string, { name = 'DaluxProxyError', status, details }: DaluxProxyErrorOptions = {}) {
    super(message);
    this.name = name;
    this.status = status;
    this.details = details;
  }
}

export interface CreateBrowserClientOptions {
  url?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

type ResourceProxy = Record<string, (...args: unknown[]) => Promise<unknown>>;

export type BrowserDaluxClient = Record<DaluxResourceName, ResourceProxy>;

/**
 * Create a browser-safe Dalux client backed by a same-origin server route.
 * The Dalux API key remains on the server; this client never accepts one.
 */
export function createBrowserClient({
  url = '/api/dalux',
  fetch: fetchImpl,
  headers = {},
}: CreateBrowserClientOptions = {}): BrowserDaluxClient {
  const request = fetchImpl || globalThis.fetch;
  if (typeof request !== 'function') {
    throw new Error('A fetch implementation is required');
  }

  const invoke = async (resource: string, method: string, args: unknown[]): Promise<unknown> => {
    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ resource, method, args }),
    });

    let payload: { ok: boolean; data?: unknown; error?: { name?: string; message?: string; details?: unknown } };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new DaluxProxyError(`Dalux proxy returned HTTP ${response.status} without JSON`, {
        status: response.status,
      });
    }

    if (!response.ok || !payload.ok) {
      const error = payload.error || {};
      throw new DaluxProxyError(error.message || `Dalux proxy returned HTTP ${response.status}`, {
        name: error.name,
        status: response.status,
        details: error.details,
      });
    }
    return payload.data;
  };

  return Object.fromEntries(
    RESOURCES.map((resource) => [
      resource,
      new Proxy(
        {},
        {
          get(_target, method) {
            if (typeof method !== 'string' || method === 'then') return undefined;
            return (...args: unknown[]) => invoke(resource, method, args);
          },
        },
      ),
    ]),
  ) as BrowserDaluxClient;
}
