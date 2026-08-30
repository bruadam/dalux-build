// Load .env file when dotenv is available (optional peer dep)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  require('dotenv').config();
} catch {
  /* dotenv not installed – skip */
}

export interface ConfigurationOptions {
  /**
   * The API base URL provided by Dalux (e.g. `https://<company>.dalux.com/api`).
   * Falls back to the `DALUX_BASE_URL` environment variable.
   */
  baseUrl?: string;
  /**
   * Your company-specific X-API-KEY.
   * Falls back to the `DALUX_API_KEY` environment variable.
   */
  apiKey?: string;
}

/**
 * Configuration for the Dalux Build API client.
 *
 * When `baseUrl` or `apiKey` are not provided they are read from the
 * environment variables `DALUX_BASE_URL` and `DALUX_API_KEY` respectively,
 * matching the behaviour of the Python client.
 */
export class Configuration {
  readonly baseUrl: string;
  readonly apiKey: string;

  constructor({ baseUrl, apiKey }: ConfigurationOptions = {}) {
    const resolvedBaseUrl = baseUrl || process.env.DALUX_BASE_URL;
    const resolvedApiKey = apiKey || process.env.DALUX_API_KEY;

    if (!resolvedBaseUrl) {
      throw new Error('baseUrl is required (or set DALUX_BASE_URL env var)');
    }
    if (!resolvedApiKey) {
      throw new Error('apiKey is required (or set DALUX_API_KEY env var)');
    }
    this.baseUrl = resolvedBaseUrl.replace(/\/$/, '');
    this.apiKey = resolvedApiKey;
  }
}
