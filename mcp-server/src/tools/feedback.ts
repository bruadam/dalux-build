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
  type: z.enum(['bug', 'enhancement']),
  title: z.string().min(1).max(200).describe('One-line issue title.'),
  body: z
    .string()
    .min(1).describe('Markdown. Server/tool behavior only; no project or personal data.'),
  confirmed: z
    .boolean()
    .optional().describe('Omit to preview. Set true only after the user approved this exact title and body.'),
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
