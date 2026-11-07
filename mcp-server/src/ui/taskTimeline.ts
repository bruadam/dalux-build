import type { McpServer } from '@modelcontextprotocol/server';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { TASK_TIMELINE_BUNDLE_JS } from './taskTimelineBundle.generated';

/**
 * Interactive lifecycle timeline for a set of Dalux tasks, delivered as an
 * MCP App (SEP-1865 `ui://` resource) — the model surfaces
 * `view_tasks_timeline`, the host renders this resource's HTML in a
 * sandboxed iframe, and the tool's `structuredContent` (already-normalized
 * task rows) is pushed to it over the MCP Apps postMessage channel.
 *
 * Unlike ui/ifcViewer.ts, this needs no signed URL or cross-origin fetch —
 * every field the chart draws is embedded directly in the tool result — so
 * it renders identically over stdio and the HTTP/OAuth deployment. The task
 * count and title length are capped so the result stays far below Claude's
 * ~150,000-character limit for results it hands to an app.
 */

export const RESOURCE_URI = 'ui://dalux-build/task-timeline';

const MAX_TASKS = 200;
const MAX_TITLE_CHARS = 200;

const TASK_TIMELINE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<style>
html,body{margin:0;padding:0;height:100%}
#root{width:100%;min-height:120px}
.timeline-message{display:flex;align-items:center;justify-content:center;min-height:120px;font:14px system-ui,sans-serif;color:#666;text-align:center;padding:16px;box-sizing:border-box}
</style>
</head>
<body>
<div id="root"></div>
<script>${TASK_TIMELINE_BUNDLE_JS}</script>
</body>
</html>`;

export const viewTasksTimelineInput = z.object({
  projectId: z.string(),
  taskIds: z
    .array(z.string())
    .min(1).max(MAX_TASKS).describe('Task IDs to show.'),
});
export type ViewTasksTimelineInput = z.infer<typeof viewTasksTimelineInput>;

const timelineTaskSchema = z.object({
  taskId: z.string(),
  label: z.string(),
  title: z.string().optional(),
  status: z.string().optional(),
  created: z.string().optional(),
  deadline: z.string().optional(),
});
export type TimelineTask = z.infer<typeof timelineTaskSchema>;

const viewTasksTimelineOutput = z.object({
  available: z.boolean(),
  tasks: z.array(timelineTaskSchema).optional(),
  skipped: z.array(z.string()).optional(),
  message: z.string().optional(),
});

function normalizeTask(taskId: string, raw: unknown): TimelineTask {
  const data = (raw as { data?: Record<string, unknown> } & Record<string, unknown>)?.data ?? raw;
  const record = (data ?? {}) as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
  };
  return {
    taskId,
    label: text('number') ?? taskId,
    title: text('title')?.slice(0, MAX_TITLE_CHARS),
    status: text('status'),
    created: text('created'),
    deadline: text('deadline'),
  };
}

/** Registers the `view_tasks_timeline` tool and its `ui://` resource on `server`. Works over any transport — no hosting dependency. */
export function registerTaskTimeline(server: McpServer, client: DaluxClient): void {
  registerAppResource(
    server,
    'task-timeline',
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: 'Lifecycle timeline for selected Dalux tasks.',
      _meta: { ui: { prefersBorder: true } },
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: TASK_TIMELINE_HTML }],
    }),
  );

  registerAppTool(
    server,
    'view_tasks_timeline',
    {
      title: 'View Tasks Timeline',
      description: 'Show a timeline (created to deadline, by status) of selected tasks in the chat.',
      inputSchema: viewTasksTimelineInput,
      outputSchema: viewTasksTimelineOutput,
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args) => {
      const results = await Promise.all(
        args.taskIds.map(async (taskId) => {
          try {
            const raw = await client.tasks.getTask(args.projectId, taskId);
            if (typeof raw === 'string' || !raw) return { taskId, ok: false as const };
            return { taskId, ok: true as const, task: normalizeTask(taskId, raw) };
          } catch {
            return { taskId, ok: false as const };
          }
        }),
      );

      const tasks = results.filter((r) => r.ok).map((r) => r.task);
      const skipped = results.filter((r) => !r.ok).map((r) => r.taskId);

      if (tasks.length === 0) {
        const message = `Couldn't load any of the requested tasks: ${skipped.join(', ')}`;
        return {
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { available: false, skipped, message },
          isError: true,
        };
      }

      const summary =
        skipped.length > 0
          ? `Rendering ${tasks.length} task(s) on the timeline (skipped ${skipped.length}: ${skipped.join(', ')}).`
          : `Rendering ${tasks.length} task(s) on the timeline.`;
      return {
        content: [{ type: 'text' as const, text: summary }],
        structuredContent: {
          available: true,
          tasks,
          ...(skipped.length > 0 ? { skipped, message: `Skipped: ${skipped.join(', ')}` } : {}),
        },
      };
    },
  );
}
