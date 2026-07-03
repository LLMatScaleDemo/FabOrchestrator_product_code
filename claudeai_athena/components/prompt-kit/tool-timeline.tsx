"use client"

import * as React from "react"
import type { ToolPart } from "@/components/prompt-kit/tool"
import type { Artifact } from "@/lib/artifacts"
import { TextShimmer } from "@/components/prompt-kit/text-shimmer"
import { motion, AnimatePresence } from "motion/react"

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

// -- ToolTimeline (main component) ---

export interface ToolTimelineProps {
  tools: ToolPart[]
  isStreaming: boolean
  /**
   * Whether the assistant text that follows this tool group has begun
   * rendering. Drives the animation lifecycle: the wave/pulse only runs
   * while we're still waiting for that text. Once tokens start (or
   * streaming ends) the "Generating Response..." label goes static.
   */
  nextTextStarted?: boolean
  /** Kept for API compat; artifacts now render once via the end-of-message
   *  ArtifactTile, not as a chip under every tool group. */
  artifacts?: Artifact[]
  onOpenArtifact?: (artifact: Artifact) => void
  defaultOpen?: boolean
}

export function ToolTimeline({
  tools,
  isStreaming,
  nextTextStarted = false,
}: ToolTimelineProps) {
  const toolsActive = tools.some(
    (t) => t.state === "input-streaming" || t.state === "input-available"
  )

  const [stage, setStage] = React.useState<1 | 2 | 3>(1)

  // Intro stage machine (1 → 2 → 3) — only advances while actively waiting
  // for the response (streaming, no text yet). Reset/advance on stream start.
  React.useEffect(() => {
    if (!isStreaming) return
    setStage(1)
    const t = setTimeout(() => {
      setStage((prev) => {
        if (prev !== 1) return prev
        const active = tools.some(
          (x) => x.state === "input-streaming" || x.state === "input-available"
        )
        return active ? 2 : 3
      })
    }, STAGE_1_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming])

  // Stage 2 → 3 when retrieval finishes. One-way: never back to 2.
  React.useEffect(() => {
    if (!isStreaming || stage < 2 || stage === 3) return
    if (!toolsActive) setStage(3)
  }, [toolsActive, isStreaming, stage])

  // Once the response text has started, or streaming has ended, the label
  // latches to its final "Generating Response..." state and stays visible.
  // Otherwise we show the live intro stage.
  const effectiveStage: 1 | 2 | 3 = !isStreaming || nextTextStarted ? 3 : stage

  // Wave/pulse animation: only while still streaming AND the response text
  // for this segment hasn't begun. After tokens start or streaming ends,
  // the label is static (text only, no animation).
  const animate = isStreaming && !nextTextStarted

  return (
    <div className="my-2">
      {/* Persistent status line. The label ("Generating Response...") stays
          visible through and after streaming; only the dot + shimmer animate,
          and only while waiting for the response text to begin. */}
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        {/* Pulsing dot — rendered only while animating ("only the text"
            remains once tokens stream / generation completes). */}
        {animate && (
          <motion.span
            aria-hidden
            className="inline-block size-2 rounded-full bg-primary"
            animate={{ scale: [1, 1.35, 1], opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        <AnimatePresence mode="wait">
          <motion.span
            key={`stage-${effectiveStage}-${animate ? "a" : "s"}`}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={effectiveStage === 1 ? "text-foreground/80" : ""}
          >
            {animate && effectiveStage !== 1 ? (
              <TextShimmer duration={2.2}>{STAGE_TEXT[effectiveStage]}</TextShimmer>
            ) : (
              STAGE_TEXT[effectiveStage]
            )}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  )
}
