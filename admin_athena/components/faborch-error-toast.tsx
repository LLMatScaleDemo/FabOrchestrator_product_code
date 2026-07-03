"use client"

import * as React from "react"
import { AlertTriangle, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FabOrchErrorEnvelope } from "@/lib/errors/client"

export interface FabOrchErrorToastProps {
  envelope: FabOrchErrorEnvelope | null
  onDismiss: () => void
  autoDismissMs?: number
  className?: string
}

/**
 * Lightweight, accessible toast that surfaces the canonical REQ-01
 * error message returned by an API call. Auto-dismisses by default.
 */
export function FabOrchErrorToast({
  envelope,
  onDismiss,
  autoDismissMs = 6000,
  className,
}: FabOrchErrorToastProps) {
  React.useEffect(() => {
    if (!envelope || autoDismissMs <= 0) return
    const id = setTimeout(onDismiss, autoDismissMs)
    return () => clearTimeout(id)
  }, [envelope, autoDismissMs, onDismiss])

  if (!envelope) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "fixed bottom-6 right-6 z-50 max-w-md rounded-xl border border-destructive/30 bg-background p-4 shadow-lg",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-4 w-4 text-destructive" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-foreground">{envelope.message}</p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {envelope.type} · {envelope.priority}
            <span className="ml-2 font-mono normal-case lowercase">
              errorId: {envelope.errorId}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Dismiss error"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
