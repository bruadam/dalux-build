'use strict';

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
];

class DaluxProxyError extends Error {
  constructor(message, { name = 'DaluxProxyError', status, details } = {}) {
    super(message);
    this.name = name;
    this.status = status;
    this.details = details;
  }
}

/**
 * Create a browser-safe Dalux client backed by a same-origin server route.
 * The Dalux API key remains on the server; this client never accepts one.
 *
 * @param {object} [options]
 * @param {string} [options.url='/api/dalux']
 * @param {typeof fetch} [options.fetch]
 * @param {Record<string, string>} [options.headers]
 */
function createBrowserClient({ url = '/api/dalux', fetch: fetchImpl, headers = {} } = {}) {
  const request = fetchImpl || globalThis.fetch;
  if (typeof request !== 'function') {
    throw new Error('A fetch implementation is required');
  }

  const invoke = async (resource, method, args) => {
    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ resource, method, args }),
    });

    let payload;
    try {
      payload = await response.json();
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

  return Object.fromEntries(RESOURCES.map((resource) => [
    resource,
    new Proxy({}, {
      get(_target, method) {
        if (typeof method !== 'string' || method === 'then') return undefined;
        return (...args) => invoke(resource, method, args);
      },
    }),
  ]));
}

module.exports = { createBrowserClient, DaluxProxyError };
