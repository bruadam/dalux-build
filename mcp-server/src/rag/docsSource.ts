/**
 * Reading a docs corpus straight from a GitHub repository — laws, guidelines,
 * standards, procedures, or whatever else lives under a folder there — over
 * the GitHub REST API. No local clone: `npm run docs:build` fetches on
 * demand and only what changed since the last build (see docsBuild.ts).
 *
 * Two ways to authenticate against a private repo:
 *  - `DOCS_GITHUB_TOKEN`/`GITHUB_TOKEN` — a real token, sent as a Bearer
 *    header. What a deployed server (Docker, HTTP transport) must use.
 *  - `DOCS_GITHUB_USE_GH_CLI=1` — shells out to the local `gh` CLI instead,
 *    reusing whatever account it's already logged into. No token ever
 *    touches this process's environment or the filesystem; only works on a
 *    host with `gh` installed and authenticated (a dev machine running the
 *    server for Claude Desktop, not a container). Ignored if a token is set.
 */

import { execFile } from 'node:child_process';
import { SUPPORTED_EXTENSIONS } from '../extract';

const GITHUB_API = 'https://api.github.com';

function useGhCli(token: string | null): boolean {
  if (token) return false;
  return process.env.DOCS_GITHUB_USE_GH_CLI === '1' || process.env.DOCS_GITHUB_USE_GH_CLI === 'true';
}

/** Runs `gh api <endpoint>` and parses its JSON stdout — same response shape as the REST API itself. */
function ghCliJson<T>(endpoint: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    execFile('gh', ['api', endpoint], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = stderr?.toString().trim() || err.message;
        reject(
          new Error(`gh api ${endpoint} failed: ${detail}. Run "gh auth login" (or "gh auth status" to check), or set DOCS_GITHUB_TOKEN instead.`),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout.toString()) as T);
      } catch (parseErr) {
        reject(new Error(`gh api ${endpoint} returned invalid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`));
      }
    });
  });
}

export interface DocsRepoScope {
  owner: string;
  repo: string;
  /** Branch, tag or commit SHA. */
  ref: string;
  /** Folder within the repo to index, e.g. "docs" — recursive, empty means the whole repo. */
  path: string;
}

export interface DocsRepoEntry {
  /** Path within the repo, e.g. "docs/laws/example-law.md". */
  path: string;
  /** Git blob SHA — changes exactly when the file's content does, so it doubles as a revision key. */
  sha: string;
}

function headers(token: string | null): Record<string, string> {
  const base: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dalux-build-mcp',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

async function githubJson<T>(url: string, token: string | null): Promise<T> {
  const response = await fetch(url, { headers: headers(token) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const hint =
      response.status === 404
        ? ' (check owner/repo/ref, and that the token — if the repo is private — can read it)'
        : response.status === 401 || response.status === 403
          ? ' (the token is missing, expired, or lacks repo access)'
          : '';
    throw new Error(`GitHub API request failed: HTTP ${response.status}${hint}. ${body.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

interface GitTreeEntry {
  path: string;
  type: string;
  sha: string;
}

interface GitTreeResponse {
  tree: GitTreeEntry[];
  truncated: boolean;
}

/**
 * Lists every readable document under `scope.path`, recursively, in one API call.
 *
 * Uses the Git Trees API (`recursive=1`) rather than walking the Contents API
 * folder by folder — one request instead of one per subfolder, at the cost of
 * silently missing entries if the repo is large enough that GitHub truncates
 * the tree (flagged as a warning by the caller, not swallowed).
 */
export async function listDocsEntries(
  scope: DocsRepoScope,
  token: string | null,
): Promise<{ entries: DocsRepoEntry[]; truncated: boolean }> {
  const endpoint = `repos/${scope.owner}/${scope.repo}/git/trees/${encodeURIComponent(scope.ref)}?recursive=1`;
  const tree = useGhCli(token)
    ? await ghCliJson<GitTreeResponse>(endpoint)
    : await githubJson<GitTreeResponse>(`${GITHUB_API}/${endpoint}`, token);

  const prefix = scope.path ? `${scope.path.replace(/^\/+|\/+$/g, '')}/` : '';
  const entries = tree.tree
    .filter((entry) => entry.type === 'blob')
    .filter((entry) => !prefix || entry.path.startsWith(prefix))
    .filter((entry) => SUPPORTED_EXTENSIONS.some((ext) => entry.path.toLowerCase().endsWith(ext)))
    .map((entry) => ({ path: entry.path, sha: entry.sha }));

  return { entries, truncated: tree.truncated };
}

interface ContentsResponse {
  content: string;
  encoding: string;
}

/** Fetches one file's raw bytes via the Contents API (base64-decoded server response). */
export async function fetchDocContent(scope: DocsRepoScope, path: string, token: string | null): Promise<Buffer> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const endpoint = `repos/${scope.owner}/${scope.repo}/contents/${encodedPath}?ref=${encodeURIComponent(scope.ref)}`;
  const data = useGhCli(token)
    ? await ghCliJson<ContentsResponse>(endpoint)
    : await githubJson<ContentsResponse>(`${GITHUB_API}/${endpoint}`, token);
  if (data.encoding !== 'base64') {
    throw new Error(`Unexpected encoding "${data.encoding}" for ${path} — expected base64.`);
  }
  return Buffer.from(data.content, 'base64');
}
