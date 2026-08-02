"use client";

import { useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Webhook } from "@/types/database";

type WebhookRow = Webhook & {
  dalux_credentials: { name: string; base_url: string } | null;
};

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  return payload.data;
}

export function WebhooksTable({ initialWebhooks }: { initialWebhooks: WebhookRow[] }) {
  const [webhooks, setWebhooks] = useState<WebhookRow[]>(initialWebhooks);
  const [busyId, setBusyId] = useState<string>("");
  const [error, setError] = useState("");

  async function toggleActive(id: string) {
    setBusyId(id);
    setError("");
    try {
      const updated = await requestJson(`/api/webhooks/${id}`, { method: "PATCH" });
      setWebhooks((current) => current.map((w) => (w.id === id ? { ...w, ...updated } : w)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  }

  async function testWebhook(webhook: WebhookRow) {
    if (!webhook.monitor_job_id) return;
    setBusyId(webhook.id);
    setError("");
    try {
      await requestJson(`/api/jobs/${encodeURIComponent(webhook.monitor_job_id)}`, {
        method: "POST",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  }

  async function deleteWebhook(webhook: WebhookRow) {
    if (!window.confirm(`Delete "${webhook.name}"? This also cancels its monitor job.`)) return;
    setBusyId(webhook.id);
    setError("");
    try {
      await requestJson(`/api/webhooks/${webhook.id}`, { method: "DELETE" });
      setWebhooks((current) => current.filter((w) => w.id !== webhook.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {webhooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No webhooks registered yet. Use &ldquo;Register webhook&rdquo; to create one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Credential</th>
                  <th className="py-2 pr-4 font-medium">Schedule</th>
                  <th className="py-2 pr-4 font-medium">Next run</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-0 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((webhook) => {
                  const busy = busyId === webhook.id;
                  return (
                    <tr key={webhook.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{webhook.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {webhook.project_id} / {webhook.file_area_id}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline">{webhook.job_type}</Badge>
                      </td>
                      <td className="py-2 pr-4">{webhook.dalux_credentials?.name ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{webhook.schedule_cron}</td>
                      <td className="py-2 pr-4 text-xs">
                        {webhook.next_run_at
                          ? new Date(webhook.next_run_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={webhook.is_active ? "secondary" : "outline"}>
                          {webhook.is_active ? "Active" : "Paused"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-0">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy || !webhook.monitor_job_id}
                            onClick={() => testWebhook(webhook)}
                          >
                            {busy && <CircleNotchIcon className="size-3.5 animate-spin" />}
                            Test
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => toggleActive(webhook.id)}
                          >
                            {webhook.is_active ? "Pause" : "Activate"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => deleteWebhook(webhook)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
