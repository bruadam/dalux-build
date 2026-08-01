"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "connect", label: "Connect" },
  { key: "project", label: "Project" },
  { key: "scope", label: "Scope" },
  { key: "delivery", label: "Delivery" },
];

export function WizardStepper({ connected, fileArea, deliveryReady }) {
  const activeMap = {
    connect: true,
    project: connected,
    scope: Boolean(fileArea),
    delivery: Boolean(fileArea) && deliveryReady,
  };

  return (
    <ol className="mb-6 grid grid-cols-4 border-b" aria-label="Registration progress">
      {STEPS.map((step, index) => {
        const active = activeMap[step.key];
        return (
          <li
            key={step.key}
            className={cn(
              "relative flex items-center justify-center gap-2 border-b-2 border-transparent pt-3.5 pb-4 text-sm font-semibold text-muted-foreground",
              active && "border-primary text-primary",
            )}
          >
            <Badge
              variant={active ? "default" : "outline"}
              className="size-6 shrink-0 rounded-full p-0"
            >
              {index + 1}
            </Badge>
            <span className="hidden sm:inline">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
