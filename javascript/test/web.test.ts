import { existsSync, readFileSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';

import {
  createWebClient,
  createWebClientFrom,
  createFetchTransport,
  TransportHttpClient,
  ApiError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  type DaluxHttpClient,
  type DaluxTransport,
} from '../src/web';

const BASE_URL = 'https://node1.field.dalux.com/service/api';
const API_KEY = 'test-key';

interface Call {
  url: URL;
  init: RequestInit;
}

/** A `fetch` that records what it was asked for and replays queued answers. */
function stubFetch(...responses: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init });
    const next = queue.shift();
    if (!next) throw new Error('stub fetch: no response queued');
    return next;
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const versionSetsBody = {
  items: [{ data: { versionSetId: 'vs1', name: 'Initial delivery', fileAreaId: 'fa1' } }],
};

describe('createWebClient', () => {
  it('resolves a relative path against the base URL and sends the API key', async () => {
    const { fetch, calls } = stubFetch(json(versionSetsBody));
    const dalux = createWebClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch });

    const result = await dalux.versionSets.getVersionSets('P1');

    expect(calls[0].url.toString()).toBe(`${BASE_URL}/2.1/projects/P1/version_sets`);
    expect(calls[0].init.method).toBe('GET');
    expect((calls[0].init.headers as Record<string, string>)['X-API-KEY']).toBe(API_KEY);
    // Zod-parsed, not the raw envelope.
    expect(result.items?.[0]).toMatchObject({ versionSetId: 'vs1', name: 'Initial delivery' });
  });

  it('never touches a global fetch', async () => {
    const globalSpy = jest.fn();
    const previous = globalThis.fetch;
    (globalThis as { fetch?: unknown }).fetch = globalSpy;
    try {
      const { fetch } = stubFetch(json(versionSetsBody));
      await createWebClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch }).versionSets.getVersionSets('P1');
      expect(globalSpy).not.toHaveBeenCalled();
    } finally {
      (globalThis as { fetch?: unknown }).fetch = previous;
    }
  });

  it('exposes every endpoint group', () => {
    const { fetch } = stubFetch();
    const dalux = createWebClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch });
    expect(Object.keys(dalux).sort()).toEqual(
      [
        'companies', 'companyCatalog', 'fileAreas', 'fileRevisions', 'files', 'folders', 'forms',
        'http', 'inspectionPlans', 'projectTemplates', 'projects', 'tasks', 'testPlans', 'users',
        'versionSets', 'workPackages',
      ].sort(),
    );
  });

  it('accepts a hand-built client for a custom transport', async () => {
    const request = jest.fn(async () => versionSetsBody);
    const dalux = createWebClientFrom(
      new TransportHttpClient({ baseUrl: BASE_URL, apiKey: API_KEY }, {
        request: request as unknown as DaluxTransport['request'],
        binary: jest.fn(),
      }),
    );

    await dalux.versionSets.getVersionSets('P1', { bookmark: 'b1' });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/2.1/projects/P1/version_sets', params: { bookmark: 'b1' } }),
    );
  });
});

describe('createFetchTransport – query parameters', () => {
  it('adds defaultParams to base-origin requests', async () => {
    const { fetch, calls } = stubFetch(json(versionSetsBody));
    const dalux = createWebClient({
      baseUrl: BASE_URL, apiKey: API_KEY, fetch, defaultParams: { daluxNode: 'node2' },
    });

    await dalux.versionSets.getVersionSets('P1');

    expect(calls[0].url.searchParams.get('daluxNode')).toBe('node2');
  });

  it('lets an explicit parameter win over a default', async () => {
    const { fetch, calls } = stubFetch(json(versionSetsBody));
    const dalux = createWebClient({
      baseUrl: BASE_URL, apiKey: API_KEY, fetch, defaultParams: { daluxNode: 'node2' },
    });

    await dalux.versionSets.getVersionSets('P1', { daluxNode: 'node7' });

    expect(calls[0].url.searchParams.get('daluxNode')).toBe('node7');
  });

  it('leaves a download link on another origin untouched', async () => {
    // A pre-signed or CDN link can carry a signature over its query string,
    // so a stray `daluxNode` would invalidate it.
    const { fetch, calls } = stubFetch(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
    );
    const dalux = createWebClient({
      baseUrl: BASE_URL, apiKey: API_KEY, fetch, defaultParams: { daluxNode: 'node2' },
    });

    const link = 'https://storage.example/dl/1?sig=abc';
    const { bytes, contentType } = await dalux.files.downloadFileBytes(link);

    expect(calls[0].url.toString()).toBe(link);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(contentType).toBe('application/octet-stream');
  });

  it('skips empty parameters', async () => {
    const { fetch, calls } = stubFetch(json(versionSetsBody));
    const dalux = createWebClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch });

    await dalux.versionSets.getVersionSets('P1', { bookmark: '', limit: 50, cursor: undefined });

    expect(calls[0].url.search).toBe('?limit=50');
  });
});

describe('createFetchTransport – bodies and status codes', () => {
  function transport(...responses: Response[]) {
    const { fetch, calls } = stubFetch(...responses);
    return { calls, transport: createFetchTransport({ baseUrl: BASE_URL, apiKey: API_KEY, fetch }) };
  }

  it('serialises a JSON body and sets Content-Type', async () => {
    const { transport: t, calls } = transport(json({ ok: true }));

    await t.request({ method: 'POST', path: '/2.0/things', body: { name: 'x' } });

    expect(calls[0].init.body).toBe('{"name":"x"}');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends no body or Content-Type on a GET', async () => {
    const { transport: t, calls } = transport(json({ ok: true }));

    await t.request({ method: 'GET', path: '/2.0/things' });

    expect(calls[0].init.body).toBeUndefined();
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('reads an empty body as null rather than failing to parse it', async () => {
    const { transport: t } = transport(new Response(null, { status: 204 }));

    await expect(t.request({ method: 'DELETE', path: '/2.0/things/1' })).resolves.toBeNull();
  });

  it('forwards an abort signal', async () => {
    const { transport: t, calls } = transport(json({ ok: true }));
    const controller = new AbortController();

    await t.request({ method: 'GET', path: '/2.0/things', signal: controller.signal });

    expect(calls[0].init.signal).toBe(controller.signal);
  });

  it.each([
    [404, NotFoundError],
    [401, AuthenticationError],
    [429, RateLimitError],
    [500, ApiError],
  ])('maps HTTP %i onto this package\'s error type', async (status, expected) => {
    const { transport: t } = transport(new Response('upstream said no', { status }));

    await expect(t.request({ method: 'GET', path: '/2.0/things' })).rejects.toBeInstanceOf(expected);
  });

  it('carries the upstream body into the thrown message', async () => {
    const { transport: t } = transport(new Response('quota exhausted for tenant', { status: 500 }));

    await expect(t.request({ method: 'GET', path: '/2.0/things' })).rejects.toThrow(
      'quota exhausted for tenant',
    );
  });
});

/**
 * The `web` entry's whole promise is that it runs in a browser and inside a
 * sandboxed plugin host. That is a property of the MODULE GRAPH — one stray
 * `import axios` anywhere below `src/web.ts` pulls axios, and through it Node
 * built-ins, back into the bundle — so it is asserted on the graph rather
 * than on the built output.
 */
describe('src/web.ts module graph', () => {
  const FORBIDDEN = ['axios', 'fs', 'path', 'readline', 'dotenv', 'os', 'crypto', 'stream', 'child_process'];

  /** Comments talk ABOUT axios and `process.env`; only code counts. */
  function sourceOf(file: string): string {
    return readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  function importsOf(file: string): string[] {
    const source = sourceOf(file);
    const specifiers: string[] = [];
    const pattern = /(?:from\s+|require\()\s*['"]([^'"]+)['"]/g;
    for (let m = pattern.exec(source); m; m = pattern.exec(source)) specifiers.push(m[1]);
    return specifiers;
  }

  function resolveLocal(from: string, specifier: string): string | null {
    const base = resolvePath(dirname(from), specifier);
    for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  const entry = resolvePath(__dirname, '../src/web.ts');
  const seen = new Set<string>();
  const external = new Map<string, string>();
  const nodeGlobals: string[] = [];

  (function walk(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    if (/\bprocess\.env\b/.test(sourceOf(file))) nodeGlobals.push(file);
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveLocal(file, specifier);
        if (resolved) walk(resolved);
        continue;
      }
      if (!external.has(specifier)) external.set(specifier, file);
    }
  })(entry);

  it('reaches more than a handful of modules (the walk actually ran)', () => {
    expect(seen.size).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)('never imports %s', (moduleName) => {
    const importer = external.get(moduleName) ?? external.get(`node:${moduleName}`);
    expect(importer ?? null).toBeNull();
  });

  it('reads no environment variables', () => {
    expect(nodeGlobals).toEqual([]);
  });

  it('pulls in FilesReadApi but not FilesApi', () => {
    const files = [...seen].map((f) => f.split('/src/')[1]);
    expect(files).toContain('api/FilesReadApi.ts');
    expect(files).not.toContain('api/FilesApi.ts');
  });
});

/**
 * The shape a plugin host actually integrates through: it already owns a
 * Dalux client (relay rewriting, logging, its own error type, its own
 * pagination rules) and wants this package's endpoint catalogue and zod
 * models on top, not its transport. `createWebClientFrom` is that seam, and
 * it is only worth anything if the host's rules survive intact.
 */
describe('a host-supplied DaluxHttpClient', () => {
  class HostError extends Error {}

  function hostClient() {
    const seen: string[] = [];
    const relay = (url: string) => `/relay?target=${encodeURIComponent(url)}`;
    const http: DaluxHttpClient = {
      configuration: { baseUrl: BASE_URL, apiKey: API_KEY },
      async get(path, params) {
        seen.push(relay(`${BASE_URL}${path}`));
        if (path.includes('/forms')) throw new HostError('host refused');
        return { items: [{ data: { versionSetId: 'vs1', name: 'Initial delivery', fileAreaId: 'fa1' } }] } as never;
      },
      async post() { throw new HostError('not used'); },
      async patch() { throw new HostError('not used'); },
      async delete() { throw new HostError('not used'); },
      async binary(url) {
        // Passed through byte-for-byte, NOT re-serialised through `new URL`.
        seen.push(url);
        return { bytes: new Uint8Array([9]).buffer };
      },
    };
    return { http, seen };
  }

  it('routes endpoint calls through the host, relay and all', async () => {
    const { http, seen } = hostClient();

    const result = await createWebClientFrom(http).versionSets.getVersionSets('P1');

    expect(seen[0]).toBe(`/relay?target=${encodeURIComponent(`${BASE_URL}/2.1/projects/P1/version_sets`)}`);
    expect(result.items?.[0]).toMatchObject({ versionSetId: 'vs1' });
  });

  it('hands a download link to the host untouched', async () => {
    const { http, seen } = hostClient();
    const signed = 'https://storage.example/dl/1?sig=abc&exp=1700000000';

    await createWebClientFrom(http).files.downloadFileBytes(signed);

    expect(seen[0]).toBe(signed);
  });

  it('lets the host\'s own errors surface unwrapped', async () => {
    const { http } = hostClient();

    await expect(createWebClientFrom(http).forms.getProjectForms('P1')).rejects.toBeInstanceOf(HostError);
  });
});
