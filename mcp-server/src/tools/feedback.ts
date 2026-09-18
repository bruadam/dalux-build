import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import {
  createFeedbackIssue,
  feedbackRepoSlug,
  feedbackReportingConfigured,
  findSensitiveContent,
  type FeedbackType,
} from '../feedbackReport';

export const reportFeedbackInput = z.object({
  type: z.enum(['bug', 'enhancement']).describe('"bug" for something broken, "enhancement" for a feature request or improvement idea.'),
  title: z.string().min(1).max(200).describe('A short, one-line summary — this becomes the GitHub issue title.'),
  body: z
    .string()
    .min(1)
    .describe(
      'The report itself, in Markdown. Describe the MCP server/tool behavior only — never include Dalux project ' +
        'data (project/file/task names or IDs, document content, company or user names) or any personal data. ' +
        'Keep it general enough that it would make sense with no context about which Dalux project or company the ' +
        'user is on.',
    ),
  confirmed: z
    .boolean()
    .optional()
    .describe(
      'Leave unset (or false) to preview the exact issue that would be filed, without posting anything. Only ' +
        'set this to true after showing the user the exact title and body from the preview and receiving their ' +
        'explicit, affirmative confirmation to post — not an inferred "sounds good", an actual yes to that exact ' +
        'content. If the user asks for any change, send a fresh (unconfirmed) call with the updated text first.',
    ),
});
export type ReportFeedbackInput = z.infer<typeof reportFeedbackInput>;

/**
 * Files a bug or enhancement report against this MCP server's GitHub repo —
 * the only tool in this server that mutates something outside a local
 * disposable cache (see feedbackReport.ts). Two-step by design: an
 * unconfirmed call only returns the preview, an agent must show that to the
 * user and get an explicit yes before the confirmed call actually posts.
 * Also refuses to post at all (confirmed or not) if the content looks like
 * it carries an email, a credential, or a Dalux identifier.
 */
export async function reportFeedback(_client: DaluxClient, args: ReportFeedbackInput) {
  const sensitive = findSensitiveContent(args.title, args.body);
  if (sensitive.length > 0) {
    const kinds = [...new Set(sensitive.map((m) => m.kind))].join(', ');
    return {
      posted: false,
      blocked: true,
      message:
        `Refusing to file this report: it looks like it contains ${kinds}. Rewrite it in general terms with no ` +
        'project data or personal data, then try again.',
    };
  }

  if (!args.confirmed) {
    return {
      posted: false,
      preview: { type: args.type, title: args.title, body: args.body, repo: feedbackRepoSlug() },
      message:
        'Not posted yet. Show the user this exact title and body and ask them to confirm — only call this tool ' +
        'again with confirmed: true once they explicitly agree to post exactly this content.',
    };
  }

  if (!feedbackReportingConfigured()) {
    return {
      posted: false,
      message:
        'This deployment has no GitHub credentials configured for feedback reporting ' +
        '(DALUX_MCP_FEEDBACK_GITHUB_TOKEN/GITHUB_TOKEN, or DALUX_MCP_FEEDBACK_USE_GH_CLI=1) — nothing was posted.',
    };
  }

  const issue = await createFeedbackIssue(args.type as FeedbackType, args.title, args.body);
  return { posted: true, url: issue.url, number: issue.number };
}
