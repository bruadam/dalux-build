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

/** How the call came in, for the audit log and request logs. Platform mode only. */
export interface RequestMeta {
  requestId: string;
  /** Shaped by the `ip_logging` setting before it gets here: full, truncated or absent. */
  ip?: string;
  forwardedFor?: string;
  userAgent?: string;
  authMethod: 'dxm' | 'dxo' | 'header' | 'agent';
  /** API token id or OAuth session id (agents: the agent id); never the secret. */
  credentialId?: string;
  mcpSessionId?: string;
  /** Mirrors `settings.log_query_text`. */
  logQueryText?: boolean;
  /** Set when the caller is a hosted agent. */
  agent?: { id: string; name: string };
}

export interface RequestContext {
  account?: { id: string; role: 'admin' | 'user' };
  connection?: { id: string; slug?: string };
  request?: RequestMeta;
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
  /** The token or OAuth client the call came in on; names the writer of memory entries. */
  client?: string;
  /** Overrides `agent:<client>` as the writer of memory entries; hosted agents set `hosted_agent:<id>`. */
  memorySource?: string;
}

export const UNRESTRICTED_CONTEXT: RequestContext = { access: 'unrestricted' };
