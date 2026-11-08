/** Fixed-window request limiter, kept in memory per process: enough to slow down guessing and registration floods. */
export interface RateLimit {
  max: number;
  windowMs: number;
}

export function createRateLimiter(limits: Record<string, RateLimit>, now: () => number = Date.now) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    /** Counts one request for `key` under the named limit; false when the limit is used up. */
    allow(name: string, key: string): boolean {
      const time = now();
      for (const [entry, window] of windows) {
        if (window.resetAt <= time) windows.delete(entry);
      }
      const id = `${name}/${key}`;
      const window = windows.get(id) ?? { count: 0, resetAt: time + limits[name].windowMs };
      window.count += 1;
      windows.set(id, window);
      return window.count <= limits[name].max;
    },
  };
}

/**
 * The client address as the reverse proxy saw it: the last X-Forwarded-For entry,
 * which is the one Caddy added (it replaces any value the client sent).
 */
export function clientAddress(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
}
