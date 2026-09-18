/**
 * Filing a bug/enhancement report from a chat session as a GitHub issue —
 * the one thing this server writes outside a local disposable cache. The
 * confirmation gate (preview first, post only once the user has explicitly
 * agreed to the exact text) lives in tools/feedback.ts; this module is just
 * the GitHub plumbing plus a best-effort scan for content that should never
 * leave the caller's own environment in the first place.
 *
 * Authenticates the same two ways as the docs-repo integration
 * (rag/docsSource.ts):
 *  - `DALUX_MCP_FEEDBACK_GITHUB_TOKEN`/`GITHUB_TOKEN` — a real token with
 *    `public_repo`/Issues:write access, sent as a Bearer header.
 *  - `DALUX_MCP_FEEDBACK_USE_GH_CLI=1` — shells out to a locally logged-in
 *    `gh` CLI instead. Ignored once a token is set.
 */

import { execFile } from 'node:child_process';

const GITHUB_API = 'https://api.github.com';
const DEFAULT_REPO = 'bruadam/dalux-build';

export type FeedbackType = 'bug' | 'enhancement';

export function feedbackRepoSlug(): string {
  return process.env.DALUX_MCP_FEEDBACK_REPO?.trim() || DEFAULT_REPO;
}

function feedbackToken(): string | null {
  return process.env.DALUX_MCP_FEEDBACK_GITHUB_TOKEN || process.env.GITHUB_TOKEN || null;
}

function useGhCli(token: string | null): boolean {
  if (token) return false;
  return process.env.DALUX_MCP_FEEDBACK_USE_GH_CLI === '1' || process.env.DALUX_MCP_FEEDBACK_USE_GH_CLI === 'true';
}

/** Whether this deployment has any way to actually file an issue — checked before doing the confirmed post. */
export function feedbackReportingConfigured(): boolean {
  return Boolean(feedbackToken()) || useGhCli(null);
}

interface SensitiveMatch {
  field: 'title' | 'body';
  kind: string;
}

// Deliberately over-inclusive: a false positive just means asking the caller
// to rephrase, whereas a false negative means project data or a credential
// reaches a public GitHub repo. Not exhaustive — this is a safety net on top
// of, not a substitute for, the explicit human confirmation step.
const SENSITIVE_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'an email address', re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
  {
    kind: 'an API key or token',
    re: /\b(sk-[a-zA-Z0-9_-]{10,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/,
  },
  { kind: 'an authorization header or API key value', re: /\b(authorization|x-api-key|x-dalux-api-key)\s*[:=]\s*\S+/i },
  { kind: 'a Dalux project/file/task identifier', re: /\b(projectId|fileAreaId|fileId|taskId)\b\s*[:=]\s*['"]?[\w-]{4,}/i },
  { kind: 'a Dalux base URL', re: /https?:\/\/[a-z0-9-]+\.dalux\.com/i },
  { kind: 'an IP address', re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
];

/** Best-effort scan of a title/body pair for content that shouldn't leave the caller's own environment. */
export function findSensitiveContent(title: string, body: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  for (const { kind, re } of SENSITIVE_PATTERNS) {
    if (re.test(title)) matches.push({ field: 'title', kind });
    if (re.test(body)) matches.push({ field: 'body', kind });
  }
  return matches;
}

export interface CreatedIssue {
  url: string;
  number: number;
}

async function createViaRest(title: string, body: string, labels: string[], token: string): Promise<CreatedIssue> {
  const response = await fetch(`${GITHUB_API}/repos/${feedbackRepoSlug()}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dalux-build-mcp',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub API request failed: HTTP ${response.status}. ${text.slice(0, 300)}`);
  }
  const data = (await response.json()) as { html_url: string; number: number };
  return { url: data.html_url, number: data.number };
}

function createViaGhCli(title: string, body: string, labels: string[]): Promise<CreatedIssue> {
  const args = ['issue', 'create', '--repo', feedbackRepoSlug(), '--title', title, '--body', body];
  for (const label of labels) args.push('--label', label);
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = stderr?.toString().trim() || err.message;
        reject(new Error(`gh issue create failed: ${detail}. Run "gh auth login", or set DALUX_MCP_FEEDBACK_GITHUB_TOKEN instead.`));
        return;
      }
      const url = stdout.toString().trim();
      const number = Number(url.split('/').filter(Boolean).pop());
      resolve({ url, number: Number.isFinite(number) ? number : 0 });
    });
  });
}

/** Files the issue. Callers must have already gated this on explicit user confirmation — see tools/feedback.ts. */
export async function createFeedbackIssue(type: FeedbackType, title: string, body: string): Promise<CreatedIssue> {
  const labels = [type];
  const token = feedbackToken();
  if (token) return createViaRest(title, body, labels, token);
  if (useGhCli(token)) return createViaGhCli(title, body, labels);
  throw new Error(
    'No GitHub credentials configured for feedback reporting — set DALUX_MCP_FEEDBACK_GITHUB_TOKEN (or GITHUB_TOKEN), ' +
      'or DALUX_MCP_FEEDBACK_USE_GH_CLI=1 on a machine with an authenticated gh CLI.',
  );
}
