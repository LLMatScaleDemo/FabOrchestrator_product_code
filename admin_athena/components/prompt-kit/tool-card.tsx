"use client"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import {
  CheckCircle,
  ChevronDown,
  Loader2,
  Database,
  XCircle,
  Wrench,
} from "lucide-react"
import { useState } from "react"

export type ToolPartState =
  | "partial-call"   // Tool is being called (streaming input)
  | "call"           // Tool call complete, waiting for result
  | "result"         // Tool result received

export interface ToolInvocationPart {
  type: "tool-invocation"
  toolInvocationId: string
  toolName: string
  args: Record<string, unknown>
  state: ToolPartState
  result?: unknown
}

export interface ToolCardProps {
  toolName: string
  state: ToolPartState
  args?: Record<string, unknown>
  result?: unknown
  toolInvocationId?: string
  defaultOpen?: boolean
  className?: string
}

export function ToolCard({
  toolName,
  state,
  args,
  result,
  toolInvocationId,
  defaultOpen = false,
  className,
}: ToolCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen || state === "partial-call")

  const getStateIcon = () => {
    switch (state) {
      case "partial-call":
        return <Loader2 className="h-4 w-4 animate-spin text-status-info" />
      case "call":
        return <Database className="h-4 w-4 text-status-warning" />
      case "result":
        return <CheckCircle className="h-4 w-4 text-status-success" />
      default:
        return <Wrench className="h-4 w-4 text-muted-foreground" />
    }
  }

  const getStateBadge = () => {
    const baseClasses = "px-2 py-0.5 rounded-full text-xs font-medium"
    switch (state) {
      case "partial-call":
        return (
          <span className={cn(baseClasses, "bg-status-info-muted text-status-info-foreground")}>
            Executing...
          </span>
        )
      case "call":
        return (
          <span className={cn(baseClasses, "bg-status-warning-muted text-status-warning-foreground")}>
            Waiting
          </span>
        )
      case "result":
        return (
          <span className={cn(baseClasses, "bg-status-success-muted text-status-success-foreground")}>
            Complete
          </span>
        )
      default:
        return null
    }
  }

  const formatToolName = (name: string) => {
    // Convert snake_case or camelCase to Title Case
    return name
      .replace(/_/g, " ")
      .replace(/([A-Z])/g, " $1")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim()
  }

  const formatValue = (value: unknown): string => {
    if (value === null) return "null"
    if (value === undefined) return "undefined"
    if (typeof value === "string") return value
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    }
    return String(value)
  }

  const isError = result && typeof result === "object" && "isError" in result && result.isError

  return (
    <div
      className={cn(
        "my-2 w-full min-w-[400px] max-w-2xl overflow-hidden rounded-lg border border-border bg-card",
        className
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full justify-between rounded-none px-3 py-2 font-normal hover:bg-muted"
          >
            <div className="flex items-center gap-2">
              {getStateIcon()}
              <span className="font-mono text-sm font-medium">
                {formatToolName(toolName)}
              </span>
              {getStateBadge()}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-200 ease-out",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-border bg-muted/30 p-3">
            {/* Input/Args Section */}
            {args && Object.keys(args).length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Input
                </h4>
                <div className="overflow-auto rounded border border-border bg-background p-2 font-mono text-sm">
                  {Object.entries(args).map(([key, value]) => (
                    <div key={key} className="mb-1 last:mb-0">
                      <span className="text-blue-600 dark:text-blue-400">{key}</span>
                      <span className="text-muted-foreground">: </span>
                      <span className="text-foreground break-all">
                        {typeof value === "string" && value.length > 100
                          ? `"${value.substring(0, 100)}..."`
                          : formatValue(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Result Section */}
            {state === "result" && result !== undefined && (
              <div>
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {isError ? "Error" : "Result"}
                </h4>
                <div
                  className={cn(
                    "max-h-60 overflow-auto rounded border p-2 font-mono text-sm",
                    isError
                      ? "border-status-error/20 bg-status-error-muted text-status-error-foreground"
                      : "border-border bg-background text-foreground"
                  )}
                >
                  <pre className="whitespace-pre-wrap break-all">
                    {formatValue(result)}
                  </pre>
                </div>
              </div>
            )}

            {/* Loading State */}
            {(state === "partial-call" || state === "call") && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>
                  {state === "partial-call"
                    ? "Preparing query..."
                    : "Executing query on Redshift..."}
                </span>
              </div>
            )}

            {/* Tool Invocation ID */}
            {toolInvocationId && (
              <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                <span className="font-mono">ID: {toolInvocationId.substring(0, 16)}...</span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/**
 * Helper to extract tool invocations from message parts
 */
export function extractToolInvocations(parts: unknown[]): ToolInvocationPart[] {
  if (!Array.isArray(parts)) return []

  return parts.filter((part): part is ToolInvocationPart => {
    if (typeof part !== "object" || part === null) return false
    return (part as ToolInvocationPart).type === "tool-invocation"
  })
}
