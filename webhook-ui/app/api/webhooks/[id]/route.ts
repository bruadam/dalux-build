import {
  deleteWebhook,
  errorResponse,
  getWebhookById,
  updateWebhook,
  UnauthorizedError,
} from "@/lib/server";
import { proxyJobAction, updateMonitorJob } from "@/lib/monitor";
import { getOrCreateAuthUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUserId } = await getOrCreateAuthUser();
    if (!appUserId) throw new UnauthorizedError();

    const { id } = await context.params;
    const webhook = await getWebhookById(id, appUserId);
    const nextActive = !webhook.is_active;

    // The monitor service is the source of truth for whether the recurring
    // job actually runs — flip it there first, and only persist locally if
    // that succeeds, so the two never drift out of sync.
    let nextRunAt = webhook.next_run_at;
    if (webhook.monitor_job_id) {
      const monitorJob = await updateMonitorJob(webhook.monitor_job_id, { enabled: nextActive });
      nextRunAt = monitorJob.nextRunAt;
    }

    const data = await updateWebhook(
      id,
      { is_active: nextActive, next_run_at: nextRunAt },
      appUserId,
    );
    return Response.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { appUserId } = await getOrCreateAuthUser();
    if (!appUserId) throw new UnauthorizedError();

    const { id } = await context.params;
    const webhook = await getWebhookById(id, appUserId);

    if (webhook.monitor_job_id) {
      // Best-effort: stop the recurring job on the monitor service too. Don't
      // block the local delete if the monitor job is already gone/unreachable.
      await proxyJobAction(webhook.monitor_job_id, "DELETE").catch((error) => {
        console.error(`Failed to delete monitor job ${webhook.monitor_job_id}:`, error);
      });
    }

    await deleteWebhook(id, appUserId);
    return Response.json({ ok: true, data: null });
  } catch (error) {
    return errorResponse(error);
  }
}
