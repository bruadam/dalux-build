import type { DaluxBinaryResponse, DaluxRequestConfig, DaluxTransport } from './transport';

/** The configuration values an API class may read off its client. */
export interface DaluxClientConfiguration {
  readonly baseUrl: string;
  /**
   * Optional, because only the Node-only `FilesApi.downloadFileFromLink`
   * reads it — it streams a download itself instead of going through the
   * client. A host that authenticates requests in its own transport has no
   * reason to hand this package a copy of its key, and requiring one here
   * would mean spreading a secret to satisfy a type.
   */
  readonly apiKey?: string;
}

/**
 * What every `*Api` class in this package needs from its HTTP client.
 *
 * Declared as an INTERFACE rather than the concrete `ApiClient` class so the
 * API classes carry no dependency on axios — importing `ApiClient` for its
 * type alone was enough to pull axios (and, through it, Node built-ins) into
 * any bundle that touched a single endpoint. `ApiClient` implements this, so
 * nothing about the Node surface changes.
 */
export interface DaluxHttpClient {
  readonly configuration: DaluxClientConfiguration;
  get<T = unknown>(path: string, params?: Record<string, unknown>, config?: DaluxRequestConfig): Promise<T>;
  post<T = unknown>(
    path: string,
    body?: unknown,
    params?: Record<string, unknown>,
    config?: DaluxRequestConfig,
  ): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, params?: Record<string, unknown>): Promise<T>;
  delete<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T>;
  /** Raw bytes from an absolute URL — a Dalux `downloadLink`. */
  binary(url: string, config?: DaluxRequestConfig): Promise<DaluxBinaryResponse>;
}

/**
 * A `DaluxHttpClient` over any {@link DaluxTransport}.
 *
 * This is what a browser or plugin host builds; `ApiClient` is the Node
 * equivalent over axios. Both exist so the eighteen API classes can be
 * written once.
 */
export class TransportHttpClient implements DaluxHttpClient {
  constructor(
    readonly configuration: DaluxClientConfiguration,
    private readonly transport: DaluxTransport,
  ) {}

  get<T = unknown>(path: string, params: Record<string, unknown> = {}, config: DaluxRequestConfig = {}): Promise<T> {
    return this.transport.request<T>({ method: 'GET', path, params, ...config });
  }

  post<T = unknown>(
    path: string,
    body: unknown = {},
    params: Record<string, unknown> = {},
    config: DaluxRequestConfig = {},
  ): Promise<T> {
    return this.transport.request<T>({ method: 'POST', path, params, body, ...config });
  }

  patch<T = unknown>(path: string, body: unknown = {}, params: Record<string, unknown> = {}): Promise<T> {
    return this.transport.request<T>({ method: 'PATCH', path, params, body });
  }

  delete<T = unknown>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.transport.request<T>({ method: 'DELETE', path, params });
  }

  binary(url: string, config: DaluxRequestConfig = {}): Promise<DaluxBinaryResponse> {
    return this.transport.binary(url, config);
  }
}
