export type AllowedMethods = string[] | Record<string, string[]>;

function normalizeAllowedMethods(allowedMethods: AllowedMethods | undefined): Set<string> {
  const normalized = new Set<string>();
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

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorStatus(error: { name?: string } | null | undefined): number {
  if (error?.name === 'AuthenticationError') return 401;
  if (error?.name === 'NotFoundError') return 404;
  if (error?.name === 'RateLimitError') return 429;
  if (error?.name === 'ValidationError') return 422;
  return 502;
}

export interface CreateDaluxRouteHandlerOptions {
  /** A server-side client from createClient(). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: Record<string, Record<string, (...args: any[]) => unknown>>;
  /** Explicit RPC allow-list. */
  allowedMethods: AllowedMethods;
  authorize?: (request: Request) => boolean | Response | Promise<boolean | Response>;
}

/**
 * Create a Next.js App Router POST handler for a browser Dalux client.
 */
export function createDaluxRouteHandler({
  client,
  allowedMethods,
  authorize,
}: CreateDaluxRouteHandlerOptions): (request: Request) => Promise<Response> {
  if (!client || typeof client !== 'object') {
    throw new Error('A server-side Dalux client is required');
  }
  const allowed = normalizeAllowedMethods(allowedMethods);

  return async function POST(request: Request): Promise<Response> {
    if (authorize) {
      const authorization = await authorize(request);
      if (authorization instanceof Response) return authorization;
      if (!authorization) {
        return json({ ok: false, error: { name: 'AuthenticationError', message: 'Unauthorized' } }, 401);
      }
    }

    let payload: { resource?: string; method?: string; args?: unknown };
    try {
      payload = (await request.json()) as typeof payload;
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

    const target = resource ? client[resource] : undefined;
    const operation = target && method ? target[method] : undefined;
    if (typeof operation !== 'function') {
      return json({ ok: false, error: { name: 'NotFoundError', message: `Unknown method ${qualifiedMethod}` } }, 404);
    }

    try {
      const data = await operation.apply(target, args);
      return json({ ok: true, data: data === undefined ? null : data });
    } catch (error) {
      const err = error as { name?: string; message?: string };
      return json(
        {
          ok: false,
          error: {
            name: err?.name || 'ApiError',
            message: err?.message || String(error),
          },
        },
        errorStatus(err),
      );
    }
  };
}
