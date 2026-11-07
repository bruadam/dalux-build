import type { Capability } from './registry';

/** One row of the caller's effective access: a capability on a connection, optionally narrowed. */
export interface EffectiveAccess {
  connectionId: string;
  capability: Capability;
  projectId: string | null;
  /** Only set for files:* capabilities. */
  fileAreaId: string | null;
  /** Only set for files:* capabilities; covers the folder and everything below it. */
  folderId: string | null;
}

export interface RequestContext {
  account?: { id: string; role: 'admin' | 'user' };
  connection?: { id: string };
  /**
   * 'unrestricted' in stdio and Dalux-header mode, where the Dalux API key is
   * the only limit. Otherwise the union of the account's and its groups' grants.
   */
  access: 'unrestricted' | EffectiveAccess[];
  /**
   * Keeps a caller's files in the cache (temporary indexes, consistency reports)
   * apart from everyone else's. Platform mode sets it for every caller: a hash of
   * the account and connection, or in header mode of the Dalux credentials.
   */
  fileNamespace?: string;
}

export const UNRESTRICTED_CONTEXT: RequestContext = { access: 'unrestricted' };
