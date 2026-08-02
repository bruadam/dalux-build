"use client";

import Image from "next/image";
import { CaretDownIcon, CircleNotchIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HOURS, MINUTES, MONTH_DAYS, WEEKDAYS } from "@/lib/wizard/constants";
import { padTime } from "@/lib/wizard/utils";

export function ScheduleStep({
  jobType,
  recurrence,
  setRecurrence,
  scheduleWeekday,
  setScheduleWeekday,
  scheduleMonthDay,
  setScheduleMonthDay,
  scheduleHour,
  setScheduleHour,
  scheduleMinute,
  setScheduleMinute,
  customCron,
  setCustomCron,
  cron,
  name,
  setName,
  timezone,
  setTimezone,
  callbackUrl,
  setCallbackUrl,
  testCallbackUrl,
  setTestCallbackUrl,
  authType,
  setAuthType,
  callbackSecret,
  setCallbackSecret,
  busy,
}) {
  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="text-xs font-extrabold tracking-wide text-primary">04</span>
          <CardTitle>Schedule and n8n delivery</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-5 grid items-start gap-3.5 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label>Recurrence</Label>
            <Select value={recurrence} onValueChange={setRecurrence}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="every15">Every 15 minutes</SelectItem>
                <SelectItem value="hourly">Every hour</SelectItem>
                <SelectItem value="daily">Once a day</SelectItem>
                <SelectItem value="weekly">Once a week</SelectItem>
                <SelectItem value="monthly">Once a month</SelectItem>
                <SelectItem value="custom">Custom cron expression</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {recurrence === "weekly" && (
            <div className="flex flex-col gap-1.5">
              <Label>Day of week</Label>
              <Select value={scheduleWeekday} onValueChange={setScheduleWeekday}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {recurrence === "monthly" && (
            <div className="flex flex-col gap-1.5">
              <Label>Day of month</Label>
              <Select value={scheduleMonthDay} onValueChange={setScheduleMonthDay}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_DAYS.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Months without this day are skipped.</p>
            </div>
          )}

          {["daily", "weekly", "monthly"].includes(recurrence) && (
            <div className="flex flex-col gap-1.5">
              <Label>Hour</Label>
              <Select value={scheduleHour} onValueChange={setScheduleHour}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((hour) => (
                    <SelectItem key={hour} value={String(hour)}>
                      {padTime(hour)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {["hourly", "daily", "weekly", "monthly"].includes(recurrence) && (
            <div className="flex flex-col gap-1.5">
              <Label>Minute</Label>
              <Select value={scheduleMinute} onValueChange={setScheduleMinute}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINUTES.map((minute) => (
                    <SelectItem key={minute} value={String(minute)}>
                      {padTime(minute)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {recurrence === "custom" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customCron">Cron expression</Label>
              <Input
                id="customCron"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                required
                placeholder="0 9 * * 1-5"
              />
            </div>
          )}

          <div className="flex min-h-[44px] flex-col justify-center gap-0.5 self-end rounded-md border bg-primary/5 px-3 py-2">
            <span className="text-[9px] font-bold tracking-wide text-muted-foreground uppercase">
              Schedule sent to monitor
            </span>
            <code className="text-xs font-bold text-primary">{cron}</code>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jobName">Job name</Label>
            <Input id="jobName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Coordination models" />
            <p className="text-xs text-muted-foreground">Optional label for your own reference.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} required placeholder="Europe/Copenhagen" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="callbackUrl">Production n8n POST URL</Label>
            <Input
              id="callbackUrl"
              type="url"
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              required
              placeholder="https://n8n.example/webhook/dalux"
            />
            <p className="text-xs text-muted-foreground">Use the production URL of an active n8n Webhook node.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="testCallbackUrl">Test n8n POST URL (optional)</Label>
            <Input
              id="testCallbackUrl"
              type="url"
              value={testCallbackUrl}
              onChange={(e) => setTestCallbackUrl(e.target.value)}
              placeholder="https://n8n.example/webhook-test/dalux"
            />
            <p className="text-xs text-muted-foreground">
              Used only by &ldquo;Send test webhook&rdquo;; falls back to the production URL above when empty.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Callback authentication</Label>
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No authentication</SelectItem>
                <SelectItem value="bearer">Bearer token</SelectItem>
                <SelectItem value="hmac-sha256">HMAC SHA-256 signature</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType !== "none" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="callbackSecret">{authType === "bearer" ? "Bearer token" : "HMAC secret"}</Label>
              <Input
                id="callbackSecret"
                type="password"
                autoComplete="new-password"
                value={callbackSecret}
                onChange={(e) => setCallbackSecret(e.target.value)}
                required
              />
            </div>
          )}
        </div>

        <Collapsible className="mt-4.5 overflow-hidden rounded-lg border bg-muted/30">
          <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-left text-xs font-bold text-primary">
            Where do I find the n8n POST URL?
            <CaretDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t px-4 py-4">
            <div className="mb-3.5">
              <strong className="text-sm">Configure the n8n Webhook node</strong>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                <li>
                  Set the HTTP Method to <code className="rounded bg-primary/10 px-1 py-0.5 text-[11px] font-bold text-primary">POST</code>.
                </li>
                <li>Open the Production URL tab and copy the displayed URL into the field above.</li>
                <li>
                  Optionally copy the Test URL tab too, into the Test n8n POST URL field, so
                  &ldquo;Send test webhook&rdquo; delivers to your in-editor workflow instead of production.
                </li>
                <li>Activate the workflow so the production URL stays live between test runs.</li>
              </ol>
            </div>
            <Image
              src="/n8n-webhook-help.png"
              width={1667}
              height={944}
              sizes="(max-width: 1120px) 100vw, 1068px"
              className="block h-auto w-full rounded-lg border bg-background"
              alt="Annotated n8n Webhook node showing where to select POST and copy the production URL"
            />
          </CollapsibleContent>
        </Collapsible>

        <div className="mt-6 flex items-center justify-between gap-4 border-t pt-5">
          <p className="text-xs text-muted-foreground">The Dalux key and callback secret are encrypted before storage.</p>
          <Button type="submit" disabled={busy === "register" || busy === "catalog"}>
            {busy === "register" && <CircleNotchIcon className="size-4 animate-spin" />}
            Register {jobType} webhook
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
