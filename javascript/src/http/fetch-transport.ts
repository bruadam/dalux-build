import {
  applyDefaultParams,
  applyParams,
  throwForStatus,
  type DaluxBinaryResponse,
  type DaluxRequest,
  type DaluxRequestConfig,
  type DaluxTransport,
} from './transport';

export interface FetchTransportOptions {
  /** Base URL, e.g. `https://node1.field.dalux.com/service/api`. */
  readonly baseUrl: string;
  readonly apiKey: string;
  /**
   * The fetch to use. REQUIRED, and deliberately not defaulted to
   * `globalThis.fetch`.
   *
   * A plugin host hands its own fetch down precisely because that wrapper is
   * where the outbound-host allow-list, the same-origin relay for an API that
   * sends no CORS headers, redirect refusal and credential omission live.
   * Silently falling back to the global would take every one of those
   * protections off without the caller noticing — the failure would not be a
   * crash, it would be a request that quietly escaped the sandbox.
   */
  readonly fetch: typeof fetch;
  /** Extra headers on every request. `X-API-KEY` is added for you. */
  readonly headers?: Record<string, string>;
  /**
   * Query parameters appended to every request on the configured base URL
   * only — Dalux's `daluxNode` selector is the case. Never added to an
   * absolute URL on another origin: a pre-signed or CDN link can carry a
   * signature computed over its query string, and a stray parameter
   * invalidates it.
   */
  readonly defaultParams?: Record<string, string>;
}

/**
 * A `DaluxTransport` over an injected `fetch`, with no axios, no `Buffer`,
 * no `process.env` and no Node built-ins — so it runs in a browser bundle
 * and, more to the point, inside a sandboxed plugin host.
 */
export function createFetchTransport(options: FetchTransportOptions): DaluxTransport {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const baseOrigin = new URL(baseUrl).origin;

  function resolve(path: string, params?: Record<string, unknown>): URL {
    const url = new URL(path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    applyParams(url, params);
    if (url.origin === baseOrigin) applyDefaultParams(url, options.defaultParams);
    return url;
  }

  function headersFor(extra?: Record<string, string>): Record<string, string> {
    return {
      'X-API-KEY': options.apiKey,
      Accept: 'application/json',
      ...options.headers,
      ...extra,
    };
  }

  async function send(url: URL, init: RequestInit, path: string): Promise<Response> {
    const response = await options.fetch(url.toString(), init);
    if (response.ok) return response;
    // The body is read once, here, so the thrown message can carry what the
    // server actually said rather than a bare status line.
    const detail = await response.text().catch(() => '');
    throwForStatus(response.status, path, detail || `HTTP ${response.status}`);
  }

  return {
    async request<T>(request: DaluxRequest): Promise<T> {
      const url = resolve(request.path, request.params);
      const hasBody = request.body !== undefined && request.method !== 'GET';
      const response = await send(
        url,
        {
          method: request.method,
          headers: headersFor({
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
            ...request.headers,
          }),
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
        },
        request.path,
      );

      if (request.responseType === 'arraybuffer') return (await response.arrayBuffer()) as T;
      // A 204, or any empty body, is `null` rather than a JSON parse error:
      // `DELETE` endpoints legitimately answer with no content.
      const text = await response.text();
      return (text ? (JSON.parse(text) as T) : null) as T;
    },

    async binary(url: string, config: DaluxRequestConfig = {}): Promise<DaluxBinaryResponse> {
      const resolved = resolve(url);
      const response = await send(
        resolved,
        {
          method: 'GET',
          headers: headersFor(config.headers),
          ...(config.signal ? { signal: config.signal } : {}),
        },
        url,
      );
      const contentType = response.headers.get('content-type') ?? undefined;
      return { bytes: await response.arrayBuffer(), ...(contentType ? { contentType } : {}) };
    },
  };
}
