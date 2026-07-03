"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { ToolPart } from "@/components/prompt-kit/tool"
import type { Artifact } from "@/lib/artifacts"
import { TextShimmer } from "@/components/prompt-kit/text-shimmer"
import { motion, AnimatePresence } from "motion/react"
import { FileText } from "lucide-react"

// Three-stage progressive flow shown while the assistant is working.
// The flow is strictly one-way (1 → 2 → 3, never backwards) and tied to
// real state: stage 2 only appears while tools are actually executing,
// stage 3 takes over once tools are done and the model is generating
// the final answer. If no tools are needed at all, we skip 2 entirely.
const STAGE_TEXT: Record<1 | 2 | 3, string> = {
  1: "Received your prompt",
  2: "Retrieval in progress...",
  3: "Generating Response...",
}

// How long the initial "Received your prompt" acknowledgement is held
// before we move on. Short enough not to feel sluggish, long enough to
// register as a real beat.
const STAGE_1_MS = 900
// Minimum time stage 2 ("Retrieval in progress...") stays visible once
// it appears, even if the tool already completed. Without this floor a
// fast tool call would flash past stage 2 invisibly.
const STAGE_2_MIN_MS = 700
// Safety cap — if for some reason tools never report completion we
// still advance to stage 3 so the loader doesn't sit on "Retrieval"
// forever.
const STAGE_2_MAX_MS = 8000

// -- ToolTimeline (main component) ---

export interface ToolTimelineProps {
  tools: ToolPart[]
  isStreaming: boolean
  artifacts?: Artifact[]
  onOpenArtifact?: (artifact: Artifact) => void
  /** Kept for API compat; no longer used. */
  defaultOpen?: boolean
}

export function ToolTimeline({
  tools,
  isStreaming,
  artifacts = [],
  onOpenArtifact,
}: ToolTimelineProps) {
  const allToolsDone =
    tools.length === 0 ||
    tools.every((t) => t.state === "output-available" || t.state === "output-error")
  const isRunning = !(allToolsDone && !isStreaming) && isStreaming

  const [stage, setStage] = React.useState<1 | 2 | 3>(1)
  // Wall-clock time when stage 2 first became visible — used to enforce
  // STAGE_2_MIN_MS so the "Retrieval in progress..." beat is always seen.
  const stage2EnteredAtRef = React.useRef<number | null>(null)

  // Stage 1 → 2. Unconditional advance after STAGE_1_MS so the
  // "Retrieval in progress..." beat is always shown — even when the
  // tool call completes very quickly or hasn't been emitted yet.
  React.useEffect(() => {
    if (!isRunning) {
      setStage(1)
      stage2EnteredAtRef.current = null
      return
    }
    setStage(1)
    stage2EnteredAtRef.current = null
    const t = setTimeout(() => {
      setStage((prev) => {
        if (prev !== 1) return prev
        stage2EnteredAtRef.current = Date.now()
        return 2
      })
    }, STAGE_1_MS)
    return () => clearTimeout(t)
  }, [isRunning])

  // Stage 2 → 3 once retrieval finishes (or after a safety cap). One-way:
  // once we've reached 3, we never go back. We hold stage 2 for at least
  // STAGE_2_MIN_MS so it doesn't flash by invisibly on fast tool calls.
  React.useEffect(() => {
    if (!isRunning) return
    if (stage !== 2) return

    const toolsActive = tools.some(
      (t) => t.state === "input-streaming" || t.state === "input-available"
    )
    const enteredAt = stage2EnteredAtRef.current ?? Date.now()
    const elapsed = Date.now() - enteredAt

    // If tools are done, schedule the advance with whatever min-dwell
    // time is left. If tools are still running, set up the safety cap.
    const delay = !toolsActive
      ? Math.max(0, STAGE_2_MIN_MS - elapsed)
      : Math.max(0, STAGE_2_MAX_MS - elapsed)

    const t = setTimeout(() => setStage(3), delay)
    return () => clearTimeout(t)
  }, [tools, isRunning, stage])

  return (
    <div className="my-2">
      {/* Loading line — only rendered while the assistant is working.
          AnimatePresence handles a clean fade/slide on enter, exit, and
          stage swap. */}
      <AnimatePresence mode="wait">
        {isRunning && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="flex items-center gap-2.5 text-sm text-muted-foreground"
          >
            {/* Pulsing brand-orange dot — picks up the app's --primary
                color so it matches the rest of the chat UI. */}
            <motion.span
              aria-hidden
              className="inline-block size-2 rounded-full bg-primary"
              animate={{
                scale: [1, 1.35, 1],
                opacity: [0.55, 1, 0.55],
              }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />

            {/* Stage text — each stage gets its own enter/exit animation.
                Stage 1 is plain text (calm acknowledgement). Stages 2
                and 3 use the shimmer to signal ongoing work. */}
            <AnimatePresence mode="wait">
              <motion.span
                key={`stage-${stage}`}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className={stage === 1 ? "text-foreground/80" : ""}
              >
                {stage === 1 ? (
                  STAGE_TEXT[1]
                ) : (
                  <TextShimmer duration={2.2}>{STAGE_TEXT[stage]}</TextShimmer>
                )}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Artifact chips, if any (only after streaming completes). */}
      {!isRunning && artifacts.length > 0 && onOpenArtifact && (
        <motion.div
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="mt-1 flex flex-wrap gap-1.5"
        >
          {artifacts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpenArtifact(a)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5",
                "text-xs font-medium text-blue-600 dark:text-blue-400",
                "border border-blue-200 dark:border-blue-800",
                "bg-blue-50 dark:bg-blue-950/30",
                "hover:bg-blue-100 dark:hover:bg-blue-900/40"
              )}
            >
              <FileText className="size-3" />
              {a.title}
            </button>
          ))}
        </motion.div>
      )}
    </div>
  )
}
