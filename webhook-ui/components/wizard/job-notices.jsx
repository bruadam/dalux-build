"use client";

import { CheckCircleIcon, CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const successAlertClass =
  "border-emerald-200 bg-emerald-50 text-emerald-900 [&_svg]:text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100 dark:[&_svg]:text-emerald-400";

export function JobNotices({ error, result, testResult, jobMessage, busy, onTestJob, onDeleteJob }) {
  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-4.5">
          <WarningCircleIcon />
          <AlertTitle>Couldn&rsquo;t continue.</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {result && (
        <Alert className={`mb-4.5 ${successAlertClass}`}>
          <CheckCircleIcon />
          <AlertTitle>Webhook registered.</AlertTitle>
          <AlertDescription className="text-emerald-800 dark:text-emerald-200">
            <p className="mb-3">The monitor is scheduled and ready.</p>
            <dl className="mb-3 flex gap-8">
              <div>
                <dt className="text-[10px] font-bold text-emerald-700 uppercase dark:text-emerald-300">Job ID</dt>
                <dd className="mt-0.5 font-mono text-[11px] break-all">{result.jobId}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold text-emerald-700 uppercase dark:text-emerald-300">Next run</dt>
                <dd className="mt-0.5 font-mono text-[11px] break-all">{new Date(result.nextRunAt).toLocaleString()}</dd>
              </div>
            </dl>
            <div className="flex gap-2.5">
              <Button type="button" variant="secondary" size="sm" onClick={onTestJob} disabled={busy === "test" || busy === "delete"}>
                {busy === "test" && <CircleNotchIcon className="size-3.5 animate-spin" />}
                Send test webhook
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={onDeleteJob} disabled={busy === "test" || busy === "delete"}>
                {busy === "delete" && <CircleNotchIcon className="size-3.5 animate-spin" />}
                Delete job
              </Button>
            </div>
            {testResult && (
              <p className="mt-3 text-xs">
                Test delivered successfully (HTTP {testResult.statusCode}, delivery {testResult.deliveryId}).
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
      {jobMessage && (
        <Alert className={`mb-4.5 ${successAlertClass}`}>
          <CheckCircleIcon />
          <AlertDescription className="text-emerald-800 dark:text-emerald-200">{jobMessage}</AlertDescription>
        </Alert>
      )}
    </>
  );
}
