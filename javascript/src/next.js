'use strict';

function normalizeAllowedMethods(allowedMethods) {
  const normalized = new Set();
  if (Array.isArray(allowedMethods)) {
    for (const method of allowedMethods) normalized.add(method);
  } else if (allowedMethods && typeof allowedMethods === 'object') {
    for (const [resource, methods] of Object.entries(allowedMethods)) {
      for (const method of methods) normalized.add(`${resource}.${method}`);
    }
  }
  if (normalized.size === 0) {
    throw new Error('allowedMethods must explicitly expose at least one Dalux client method');
  }
  return normalized;
}

function json(body, status = 200) {
  return Response.json(body, { status });
}

function errorStatus(error) {
  if (error?.name === 'AuthenticationError') return 401;
  if (error?.name === 'NotFoundError') return 404;
  if (error?.name === 'RateLimitError') return 429;
  if (error?.name === 'ValidationError') return 422;
  return 502;
}

/**
 * Create a Next.js App Router POST handler for a browser Dalux client.
 *
 * @param {object} options
 * @param {object} options.client A server-side client from createClient().
 * @param {string[]|Record<string, string[]>} options.allowedMethods Explicit RPC allow-list.
 * @param {(request: Request) => boolean|Response|Promise<boolean|Response>} [options.authorize]
 * @returns {(request: Request) => Promise<Response>}
 */
function createDaluxRouteHandler({ client, allowedMethods, authorize } = {}) {
  if (!client || typeof client !== 'object') {
    throw new Error('A server-side Dalux client is required');
  }
  const allowed = normalizeAllowedMethods(allowedMethods);

  return async function POST(request) {
    if (authorize) {
      const authorization = await authorize(request);
      if (authorization instanceof Response) return authorization;
      if (!authorization) return json({ ok: false, error: { name: 'AuthenticationError', message: 'Unauthorized' } }, 401);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: { name: 'ValidationError', message: 'Request body must be JSON' } }, 400);
    }

    const { resource, method, args = [] } = payload || {};
    const qualifiedMethod = `${resource}.${method}`;
    if (!allowed.has(qualifiedMethod)) {
      return json({ ok: false, error: { name: 'NotFoundError', message: `Method ${qualifiedMethod} is not exposed` } }, 404);
    }
    if (!Array.isArray(args)) {
      return json({ ok: false, error: { name: 'ValidationError', message: 'args must be an array' } }, 400);
    }

    const target = client[resource];
    const operation = target?.[method];
    if (typeof operation !== 'function') {
      return json({ ok: false, error: { name: 'NotFoundError', message: `Unknown method ${qualifiedMethod}` } }, 404);
    }

    try {
      const data = await operation.apply(target, args);
      return json({ ok: true, data: data === undefined ? null : data });
    } catch (error) {
      return json({
        ok: false,
        error: {
          name: error?.name || 'ApiError',
          message: error?.message || String(error),
        },
      }, errorStatus(error));
    }
  };
}

module.exports = { createDaluxRouteHandler };
