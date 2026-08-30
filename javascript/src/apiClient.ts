import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { NotFoundError, AuthenticationError, RateLimitError, ApiError } from './utils/errors';
import { Configuration } from './configuration';

// Load .env file when dotenv is available (optional peer dep)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  require('dotenv').config();
} catch {
  /* dotenv not installed – skip */
}

/**
 * Base HTTP client that attaches the X-API-KEY header to every request.
 *
 * When `configuration` is omitted the client reads `DALUX_BASE_URL` and
 * `DALUX_API_KEY` from the environment, matching the Python client behaviour.
 */
export class ApiClient {
  readonly configuration: Configuration;
  /** Not TS-`private` (unlike the class's other internals) because tests inject axios-mock-adapter via `client._axios`, matching the original JS's convention-only privacy. */
  readonly _axios: AxiosInstance;

  constructor(configuration?: Configuration) {
    if (!configuration) {
      configuration = new Configuration();
    }
    this.configuration = configuration;

    this._axios = axios.create({
      baseURL: configuration.baseUrl,
      headers: {
        'X-API-KEY': configuration.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'dalux-build-js/1.0',
      },
    });
  }

  /**
   * Extract a human-readable error detail from an Axios error response.
   */
  private _getErrorDetail(response: AxiosResponse): string {
    try {
      const data = response.data;
      if (Buffer.isBuffer(data)) {
        return data.toString('utf8').slice(0, 200);
      }
      if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString('utf8').slice(0, 200);
      }
      if (data && typeof data === 'object') {
        if (data.message) return data.message;
        if (data.error) return data.error;
        return JSON.stringify(data);
      }
      return String(data).slice(0, 100);
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  /**
   * Map an Axios error to the appropriate Dalux error class.
   */
  private _handleAxiosError(err: AxiosError, path: string): never {
    if (err.response) {
      const { status } = err.response;
      const detail = this._getErrorDetail(err.response);
      if (status === 404) throw new NotFoundError(`Resource not found: ${path}`);
      if (status === 401) throw new AuthenticationError('Authentication failed');
      if (status === 429) throw new RateLimitError('Rate limit exceeded');
      throw new ApiError(`API request failed: ${detail}`);
    }
    throw new ApiError(`Request failed: ${err.message}`);
  }

  /**
   * Perform a GET request.
   * @param path - URL path (e.g. '/5.1/projects')
   * @param params - Query string parameters
   * @param config - Extra axios config (e.g. { responseType: 'arraybuffer' } for binary content)
   */
  async get<T = unknown>(
    path: string,
    params: Record<string, unknown> = {},
    config: AxiosRequestConfig = {},
  ): Promise<T> {
    try {
      const response = await this._axios.get(path, { params, ...config });
      return response.data;
    } catch (err) {
      this._handleAxiosError(err as AxiosError, path);
    }
  }

  /**
   * Perform a POST request.
   */
  async post<T = unknown>(
    path: string,
    body: unknown = {},
    params: Record<string, unknown> = {},
    config: AxiosRequestConfig = {},
  ): Promise<T> {
    try {
      const response = await this._axios.post(path, body, { params, ...config });
      return response.data;
    } catch (err) {
      this._handleAxiosError(err as AxiosError, path);
    }
  }

  /**
   * Perform a PATCH request.
   */
  async patch<T = unknown>(
    path: string,
    body: unknown = {},
    params: Record<string, unknown> = {},
  ): Promise<T> {
    try {
      const response = await this._axios.patch(path, body, { params });
      return response.data;
    } catch (err) {
      this._handleAxiosError(err as AxiosError, path);
    }
  }

  /**
   * Perform a DELETE request.
   */
  async delete<T = unknown>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      const response = await this._axios.delete(path, { params });
      return response.data;
    } catch (err) {
      this._handleAxiosError(err as AxiosError, path);
    }
  }
}
