import {
  checkWebhookLimit,
  createDaluxCredential,
  createWebhook,
  getDaluxCredentialById,
  errorResponse,
  requireString,
  resolveBaseUrl,
  UnauthorizedError,
} from "../../../lib/server";
import { getOrCreateAuthUser } from "../../../lib/supabase/auth";
import { proxyJobAction, registerMonitorJob } from "../../../lib/monitor";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { appUserId } = await getOrCreateAuthUser();
    if (!appUserId) throw new UnauthorizedError();

    const payload = await request.json();
    const jobType = payload?.jobType;
    if (!["change", "freshness"].includes(jobType)) {
      const error = new Error("jobType must be change or freshness");
      error.status = 400;
      throw error;
    }
    const job = payload?.job || {};

    // Resolve (or create) the Dalux credential this job will run as.
    let credentialId = job.credentialId;
    let daluxApiKey;
    let daluxBaseUrl;
    if (credentialId) {
      const credential = await getDaluxCredentialById(credentialId, appUserId);
      daluxApiKey = credential.api_key;
      daluxBaseUrl = resolveBaseUrl(credential.base_url);
    } else {
      daluxApiKey = requireString(job.daluxApiKey, "daluxApiKey");
      daluxBaseUrl = resolveBaseUrl(job.daluxBaseUrl);
      const created = await createDaluxCredential({
        user_id: appUserId,
        name: job.credentialName || `Dalux credential ${new Date().toISOString()}`,
        api_key: daluxApiKey,
        base_url: daluxBaseUrl,
      });
      credentialId = created.id;
    }

    // Fail fast, before touching the monitor service, if this would exceed
    // the user's webhook limit.
    const limitCheck = await checkWebhookLimit();
    if (!limitCheck.canCreate) {
      const error = new Error(limitCheck.error || "Webhook limit reached");
      error.status = 402;
      throw error;
    }

    const monitorJob = { ...job, daluxApiKey, daluxBaseUrl };
    delete monitorJob.credentialId;
    delete monitorJob.credentialName;

    const { body, status } = await registerMonitorJob(jobType, monitorJob, payload.idempotencyKey);

    // Persist the registration. If this fails, the monitor job still exists
    // but we couldn't record it locally — roll it back so we don't leave an
    // orphaned job the user has no way to see or manage.
    try {
      await createWebhook({
        user_id: appUserId,
        credential_id: credentialId,
        name: job.name || `${jobType} monitor`,
        job_type: jobType,
        project_id: job.projectId,
        file_area_id: job.fileAreaId,
        file_ids: job.scope?.fileIds?.length ? job.scope.fileIds : null,
        folder_ids: job.folderIds?.length ? job.folderIds : null,
        schedule_type: "custom",
        schedule_cron: job.cron,
        webhook_url: job.callback?.url,
        test_webhook_url: job.testCallback?.url || null,
        webhook_method: "POST",
        is_active: true,
        monitor_job_id: body?.jobId ? String(body.jobId) : null,
        next_run_at: body?.nextRunAt || null,
      });
    } catch (persistError) {
      console.error("Failed to persist webhook after monitor registration:", persistError);
      if (body?.jobId) {
        await proxyJobAction(String(body.jobId), "DELETE").catch(() => {});
      }
      throw persistError;
    }

    return Response.json({ ok: true, data: body }, { status });
  } catch (error) {
    return errorResponse(error);
  }
}
