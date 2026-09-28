import { NotFoundError, AuthenticationError, RateLimitError, ApiError } from '../utils/errors';

/**
 * Per-request options a transport understands.
 *
 * Deliberately a small, transport-neutral subset rather than
 * `AxiosRequestConfig`: the axios type is what tied every API class in this
 * package to one HTTP library, and the only two things the API classes
 * actually ask for are a binary response and (now) cancellation.
 */
export interface DaluxRequestConfig {
  /** `'arraybuffer'` for file content; anything else is parsed as JSON. */
  responseType?: 'json' | 'arraybuffer';
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface DaluxRequest extends DaluxRequestConfig {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path relative to the configured base URL, or an absolute URL. */
  path: string;
  params?: Record<string, unknown>;
  body?: unknown;
}

/** Binary responses keep their content type, which callers relay onward. */
export interface DaluxBinaryResponse {
  readonly bytes: ArrayBuffer;
  readonly contentType?: string;
}

/**
 * How this package talks HTTP.
 *
 * The seam exists so the client can run somewhere axios cannot: a browser
 * plugin host that requires every request to go through ITS fetch, because
 * that fetch is where the permission allow-list, the same-origin relay for a
 * CORS-less API, redirect refusal and credential omission are enforced. A
 * library that reached for `axios` (or bare `globalThis.fetch`) would walk
 * straight around all of it — see `createFetchTransport`.
 */
export interface DaluxTransport {
  request<T = unknown>(request: DaluxRequest): Promise<T>;
  /** Raw bytes from an absolute URL (a Dalux `downloadLink`), unparsed. */
  binary(url: string, config?: DaluxRequestConfig): Promise<DaluxBinaryResponse>;
}

/** Longest upstream body echoed into a thrown message. */
const MAX_ERROR_DETAIL = 200;

/**
 * Maps an HTTP status onto this package's error classes, so a caller gets
 * `NotFoundError` whether the request went out through axios or fetch.
 */
export function throwForStatus(status: number, path: string, detail: string): never {
  if (status === 404) throw new NotFoundError(`Resource not found: ${path}`);
  if (status === 401) throw new AuthenticationError('Authentication failed');
  if (status === 429) throw new RateLimitError('Rate limit exceeded');
  throw new ApiError(`API request failed: ${detail.slice(0, MAX_ERROR_DETAIL)}`);
}

/** Appends defined query parameters to `url`, skipping empty values. */
export function applyParams(url: URL, params: Record<string, unknown> | undefined): void {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
}

/**
 * Same, but never overwrites a parameter the URL or the caller already set.
 *
 * Defaults are a fallback, not an override: a caller passing `daluxNode`
 * explicitly, or a link that already carries one, means it.
 */
export function applyDefaultParams(url: URL, params: Record<string, string> | undefined): void {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === '' || url.searchParams.has(key)) continue;
    url.searchParams.set(key, value);
  }
}
