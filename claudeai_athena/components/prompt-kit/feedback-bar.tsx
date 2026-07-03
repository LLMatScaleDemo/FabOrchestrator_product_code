"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ThumbsDown, ThumbsUp, X } from "lucide-react"

type FeedbackBarProps = {
  className?: string
  title?: string
  icon?: React.ReactNode
  onHelpful?: () => void
  onNotHelpful?: () => void
  onClose?: () => void
}

export function FeedbackBar({
  className,
  title = "Was this response helpful?",
  icon,
  onHelpful,
  onNotHelpful,
  onClose,
}: FeedbackBarProps) {
  const [feedback, setFeedback] = React.useState<"helpful" | "not-helpful" | null>(null)
  const [dismissed, setDismissed] = React.useState(false)

  if (dismissed) return null

  if (feedback) {
    return (
      <div
        className={cn(
          "bg-background border-border inline-flex rounded-[12px] border text-sm",
          className
        )}
      >
        <div className="flex w-full items-center justify-between">
          <div className="flex flex-1 items-center justify-start gap-4 py-3 pl-4 pr-4">
            {feedback === "helpful" ? (
              <ThumbsUp className="size-4 text-status-success animate-success" />
            ) : (
              <ThumbsDown className="size-4 text-status-error" />
            )}
            <span className="text-foreground font-medium animate-slide-up-fade">Thanks for your feedback!</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "bg-background border-border inline-flex rounded-[12px] border text-sm",
        className
      )}
    >
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-1 items-center justify-start gap-4 py-3 pl-4">
          {icon}
          <span className="text-foreground font-medium">{title}</span>
        </div>
        <div className="flex items-center justify-center gap-0.5 px-3 py-0">
          <button
            type="button"
            className="text-muted-foreground hover:text-status-success flex size-8 items-center justify-center rounded-md transition-colors"
            aria-label="Helpful"
            onClick={() => {
              setFeedback("helpful")
              onHelpful?.()
            }}
          >
            <ThumbsUp className="size-4" />
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-status-error flex size-8 items-center justify-center rounded-md transition-colors"
            aria-label="Not helpful"
            onClick={() => {
              setFeedback("not-helpful")
              onNotHelpful?.()
            }}
          >
            <ThumbsDown className="size-4" />
          </button>
        </div>
        {onClose && (
          <div className="border-border flex items-center justify-center border-l">
            <button
              type="button"
              onClick={() => {
                setDismissed(true)
                onClose?.()
              }}
              className="text-muted-foreground hover:text-foreground flex items-center justify-center rounded-md p-3"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
