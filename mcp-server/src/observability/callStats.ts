import { AsyncLocalStorage } from 'node:async_hooks';

import type { DaluxClient } from 'dalux-build-api';

/** What one tool call used, filled in while it runs and written to the audit log with it. */
export interface CallStats {
  daluxCalls: number;
  daluxErrors: number;
  daluxRateLimited: number;
  mistralTokens: number;
  errorCode?: string;
  resultItems?: number;
  resultTruncated?: boolean;
}

const storage = new AsyncLocalStorage<CallStats>();

export function runWithCallStats<T>(fn: (stats: CallStats) => T): T {
  const stats: CallStats = { daluxCalls: 0, daluxErrors: 0, daluxRateLimited: 0, mistralTokens: 0 };
  return storage.run(stats, () => fn(stats));
}

export function currentCallStats(): CallStats | undefined {
  return storage.getStore();
}

/** A short code for an error thrown by a tool or the Dalux client; never the message, which can name resources. */
export function errorCodeOf(error: unknown): string {
  switch (error instanceof Error ? error.name : '') {
    case 'NotFoundError':
      return 'not_found';
    case 'RateLimitError':
      return 'rate_limited';
    case 'AuthenticationError':
      return 'dalux_auth';
    case 'ApiError':
      return 'dalux_error';
    case 'ZodError':
      return 'invalid_arguments';
    default:
      return 'tool_error';
  }
}

/** Counts the calls of each API group of `client`, and the ones that fail, for the tool call that makes them. */
export function countDaluxCalls(client: DaluxClient): DaluxClient {
  const counted = (api: object) =>
    new Proxy(api, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          const stats = currentCallStats();
          if (!stats || typeof result?.then !== 'function') return result;
          stats.daluxCalls += 1;
          return (result as Promise<unknown>).catch((error: unknown) => {
            stats.daluxErrors += 1;
            if (errorCodeOf(error) === 'rate_limited') stats.daluxRateLimited += 1;
            throw error;
          });
        };
      },
    });
  return Object.fromEntries(Object.entries(client).map(([name, api]) => [name, counted(api)])) as unknown as DaluxClient;
}
