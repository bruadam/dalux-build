"use client";

import { CircleNotchIcon } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ConnectionStep({ apiKey, setApiKey, baseUrl, setBaseUrl, connected, busy, onConnect }) {
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
        <form className="grid items-start gap-4 md:grid-cols-[1fr_1.35fr_auto]" onSubmit={onConnect}>
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
              Used only for catalog browsing and encrypted when the job is saved.
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
        </form>
      </CardContent>
    </Card>
  );
}
