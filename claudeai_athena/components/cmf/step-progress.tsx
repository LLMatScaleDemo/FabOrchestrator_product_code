"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardStep = {
  key: string;
  label: string;
};

type Props = {
  steps: WizardStep[];
  /** 0-based index of the current step. */
  current: number;
  /** Highest step index the user may jump back to (<= current). */
  maxReachable: number;
  onStepClick?: (index: number) => void;
};

export function StepProgress({ steps, current, maxReachable, onStepClick }: Props) {
  return (
    <ol
      className="flex w-full items-center gap-1.5 sm:gap-2"
      aria-label={`Step ${current + 1} of ${steps.length}`}
    >
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = i <= maxReachable;
        const clickable = reachable && !!onStepClick && !active;
        return (
          <li
            key={step.key}
            className={cn("flex items-center gap-1.5 sm:gap-2", i < steps.length - 1 && "flex-1")}
          >
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(i)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "group flex items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-sm transition-colors outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring/50",
                active && "bg-primary/10 font-medium text-primary",
                !active && done && "text-foreground",
                !active && !done && "text-muted-foreground",
                clickable && "hover:bg-muted",
                !clickable && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary bg-background text-primary ring-2 ring-primary/20",
                  !done && !active && "border-border bg-background text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className="hidden whitespace-nowrap sm:inline">{step.label}</span>
            </button>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "h-0.5 flex-1 rounded-full transition-colors",
                  done ? "bg-primary" : "bg-border",
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
