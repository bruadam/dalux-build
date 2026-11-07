import { AsyncLocalStorage } from 'node:async_hooks';

import { UNRESTRICTED_CONTEXT, type RequestContext } from './context';

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` as the caller of every tool call and store query made inside it. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The caller of the current request; unrestricted outside a request (stdio, tests, scripts). */
export function currentContext(): RequestContext {
  return storage.getStore() ?? UNRESTRICTED_CONTEXT;
}

/**
 * Who owns what the current caller creates (jobs, edit sessions, viewer selections):
 * account and connection, else the header-mode file namespace; undefined in stdio
 * and non-platform HTTP, where everything is shared as before.
 */
export function currentCaller(): string | undefined {
  const { account, connection, fileNamespace } = currentContext();
  return account ? `${account.id}/${connection?.id ?? ''}` : fileNamespace;
}
