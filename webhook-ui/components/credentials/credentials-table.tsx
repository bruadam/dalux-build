"use client";

import { useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FALLBACK_BASE_URL } from "@/lib/wizard/constants";
import type { DaluxCredential } from "@/types/database";

type PublicCredential = DaluxCredential;

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  return payload.data;
}

export function CredentialsTable({
  initialCredentials,
}: {
  initialCredentials: PublicCredential[];
}) {
  const [credentials, setCredentials] = useState<PublicCredential[]>(initialCredentials);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(FALLBACK_BASE_URL);

  async function createCredential(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const credential = await requestJson("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, apiKey, baseUrl }),
      });
      setCredentials((current) => [credential, ...current]);
      setName("");
      setApiKey("");
      setBaseUrl(FALLBACK_BASE_URL);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function deleteCredential(credential: PublicCredential) {
    if (!window.confirm(`Delete "${credential.name}"? Webhooks using it keep working, but you won't be able to reuse it for new ones.`)) {
      return;
    }
    setBusyId(credential.id);
    setError("");
    try {
      await requestJson(`/api/credentials/${credential.id}`, { method: "DELETE" });
      setCredentials((current) => current.filter((c) => c.id !== credential.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Credentials</CardTitle>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add credential"}
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {showForm && (
          <form
            className="mb-5 grid items-start gap-4 rounded-lg border bg-muted/30 p-4 md:grid-cols-[1fr_1fr_1.35fr_auto]"
            onSubmit={createCredential}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="credName">Name</Label>
              <Input
                id="credName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Main Dalux account"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="credApiKey">DALUX_API_KEY</Label>
              <Input
                id="credApiKey"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                placeholder="Paste your Dalux API key"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="credBaseUrl">Base URL</Label>
              <Input
                id="credBaseUrl"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={creating} className="md:mt-6.5">
              {creating && <CircleNotchIcon className="size-4 animate-spin" />}
              Save
            </Button>
          </form>
        )}

        {credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved credentials yet. Add one here, or save one while registering a webhook.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Base URL</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-0 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((credential) => {
                  const busy = busyId === credential.id;
                  return (
                    <tr key={credential.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{credential.name}</div>
                        {credential.description && (
                          <div className="text-xs text-muted-foreground">{credential.description}</div>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{credential.base_url}</td>
                      <td className="py-2 pr-4">
                        <div className="flex gap-1.5">
                          <Badge variant={credential.is_active ? "secondary" : "outline"}>
                            {credential.is_active ? "Active" : "Inactive"}
                          </Badge>
                          {credential.is_default && <Badge variant="outline">Default</Badge>}
                        </div>
                      </td>
                      <td className="py-2 pr-0">
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => deleteCredential(credential)}
                          >
                            {busy && <CircleNotchIcon className="size-3.5 animate-spin" />}
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
