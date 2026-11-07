import { Cache } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { accountId } from "./client";

export const MINUTE = 60 * 1000;

const cache = new Cache({ capacity: 200 * 1024 * 1024 });

interface Entry<T> {
  fetchedAt: number;
  data: T;
}

function read<T>(key: string): Entry<T> | undefined {
  const raw = cache.get(key);
  return raw ? (JSON.parse(raw) as Entry<T>) : undefined;
}

function write<T>(key: string, entry: Entry<T>): void {
  cache.set(key, JSON.stringify(entry));
}

function scope(key: string | undefined): { key?: string; error?: Error } {
  try {
    return { key: key && `${accountId()}:${key}` };
  } catch (error) {
    return { error: error as Error };
  }
}

export interface CachedLoad<T> {
  data: T | undefined;
  fetchedAt: number | undefined;
  isLoading: boolean;
  error: Error | undefined;
  refresh: () => void;
}

/**
 * Loads data at most once per `ttlMs` and keeps it in the extension's Cache,
 * which all commands share. Cached data shows at once, even when stale, while
 * a reload runs. Cache keys are scoped to the configured account. Pass
 * `key: undefined` to wait (e.g. until a project is picked). `refresh()`
 * forces a reload.
 */
export function useCachedLoad<T>(key: string | undefined, ttlMs: number, load: () => Promise<T>): CachedLoad<T> {
  const [version, setVersion] = useState(0);
  const scoped = scope(key);
  const entry = useMemo(() => (scoped.key ? read<T>(scoped.key) : undefined), [scoped.key, version]);
  const stale = !entry || Date.now() - entry.fetchedAt > ttlMs;
  const execute = Boolean(scoped.key) && stale;

  const { isLoading, error } = usePromise(
    // `version` is only an argument so that `refresh()` re-runs the load.
    async (...[cacheKey]: [string, number]) => {
      const data = await load();
      write(cacheKey, { fetchedAt: Date.now(), data });
    },
    [scoped.key ?? "", version],
    {
      execute,
      onData: () => setVersion((v) => v + 1),
      // Commands render errors themselves (see ErrorView).
      onError: () => undefined,
    },
  );

  return {
    data: entry?.data,
    fetchedAt: entry?.fetchedAt,
    isLoading: execute && isLoading,
    error: scoped.error ?? (execute && !isLoading ? error : undefined),
    refresh: () => {
      if (scoped.key && entry) write(scoped.key, { ...entry, fetchedAt: 0 });
      setVersion((v) => v + 1);
    },
  };
}
