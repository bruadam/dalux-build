"use client";

import { CircleNotchIcon } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ConnectionStep({
  savedCredentials,
  credentialMode,
  setCredentialMode,
  credentialName,
  setCredentialName,
  apiKey,
  setApiKey,
  baseUrl,
  setBaseUrl,
  connected,
  busy,
  onConnect,
}) {
  const selectedSaved =
    credentialMode !== "new" ? savedCredentials.find((c) => c.id === credentialMode) : null;
  const isNew = credentialMode === "new";

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-extrabold tracking-wide text-primary">01</span>
          <CardTitle>Dalux connection</CardTitle>
        </div>
        {connected && <Badge variant="secondary">Connected</Badge>}
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onConnect}>
          {savedCredentials.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="credentialPicker">Credential</Label>
              <Select value={credentialMode} onValueChange={setCredentialMode}>
                <SelectTrigger id="credentialPicker" className="w-full md:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {savedCredentials.map((credential) => (
                    <SelectItem key={credential.id} value={credential.id}>
                      {credential.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="new">+ Add new credential</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {isNew ? (
            <div className="grid items-start gap-4 md:grid-cols-[1fr_1fr_1.1fr_auto]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="credentialName">Name</Label>
                <Input
                  id="credentialName"
                  value={credentialName}
                  onChange={(e) => setCredentialName(e.target.value)}
                  placeholder="e.g. Main Dalux account"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="apiKey">DALUX_API_KEY</Label>
                <Input
                  id="apiKey"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  placeholder="Paste your Dalux API key"
                />
                <p className="text-xs text-muted-foreground">
                  Stored so you can reuse this connection for future webhooks.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Change this only when your Dalux environment uses another API host.
                </p>
              </div>
              <Button type="submit" disabled={busy === "projects"} className="md:mt-6.5">
                {busy === "projects" && <CircleNotchIcon className="size-4 animate-spin" />}
                {connected ? "Reconnect" : "Connect & load projects"}
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Base URL</span>
                <span className="text-sm">{selectedSaved?.base_url}</span>
              </div>
              <Button type="submit" disabled={busy === "projects"}>
                {busy === "projects" && <CircleNotchIcon className="size-4 animate-spin" />}
                {connected ? "Reconnect" : "Connect & load projects"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
