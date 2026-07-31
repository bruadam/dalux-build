'use strict';

const axios = require('axios');
const { NotFoundError, AuthenticationError, RateLimitError, ApiError } = require('./utils/errors');

// Load .env file when dotenv is available (optional peer dep)
try {
  require('dotenv').config();
} catch (_) { /* dotenv not installed – skip */ }

/**
 * Base HTTP client that attaches the X-API-KEY header to every request.
 *
 * When *configuration* is omitted the client reads ``DALUX_BASE_URL`` and
 * ``DALUX_API_KEY`` from the environment, matching the Python client behaviour.
 */
class ApiClient {
  /**
   * @param {import('./configuration')} [configuration]
   */
  constructor(configuration) {
    if (!configuration) {
      const Configuration = require('./configuration');
      configuration = new Configuration();
    }
    this.configuration = configuration;

    this._axios = axios.create({
      baseURL: configuration.baseUrl,
      headers: {
        'X-API-KEY': configuration.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'dalux-build-js/1.0',
      },
    });
  }

  /**
   * Extract a human-readable error detail from an Axios error response.
   * @param {import('axios').AxiosResponse} response
   * @returns {string}
   */
  _getErrorDetail(response) {
    try {
      const data = response.data;
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
   * @param {import('axios').AxiosError} err
   * @param {string} path
   */
  _handleAxiosError(err, path) {
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
   * @param {string} path  - URL path (e.g. '/5.1/projects')
   * @param {object} [params] - Query string parameters
   * @returns {Promise<any>} Parsed response body
   */
  async get(path, params = {}) {
    try {
      const response = await this._axios.get(path, { params });
      return response.data;
    } catch (err) {
      this._handleAxiosError(err, path);
    }
  }

  /**
   * Perform a POST request.
   * @param {string} path
   * @param {object} [body]
   * @param {object} [params]
   * @param {object} [config] - Extra axios config (e.g. custom headers or responseType)
   * @returns {Promise<any>}
   */
  async post(path, body = {}, params = {}, config = {}) {
    try {
      const response = await this._axios.post(path, body, { params, ...config });
      return response.data;
    } catch (err) {
      this._handleAxiosError(err, path);
    }
  }

  /**
   * Perform a PATCH request.
   * @param {string} path
   * @param {object} [body]
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  async patch(path, body = {}, params = {}) {
    try {
      const response = await this._axios.patch(path, body, { params });
      return response.data;
    } catch (err) {
      this._handleAxiosError(err, path);
    }
  }

  /**
   * Perform a DELETE request.
   * @param {string} path
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  async delete(path, params = {}) {
    try {
      const response = await this._axios.delete(path, { params });
      return response.data;
    } catch (err) {
      this._handleAxiosError(err, path);
    }
  }
}

module.exports = ApiClient;
