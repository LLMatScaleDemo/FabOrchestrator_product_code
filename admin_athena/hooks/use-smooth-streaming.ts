"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"

interface UseSmoothStreamingOptions {
  /** Characters to reveal per tick (default: 3) */
  charsPerTick?: number
  /** Milliseconds between ticks (default: 16 for ~60fps) */
  tickInterval?: number
  /** Whether streaming is active (default: true) */
  isStreaming?: boolean
  /** Callback when streaming completes */
  onComplete?: () => void
  /** Adaptive speed - increases when far behind (default: true) */
  adaptiveSpeed?: boolean
  /** Maximum characters to catch up per tick when behind (default: 20) */
  maxCatchUpChars?: number
}

/**
 * Hook for smooth text streaming animation
 * Buffers incoming text and reveals it gradually for a smoother reading experience
 * Optimized for performance with requestAnimationFrame
 */
export function useSmoothStreaming(
  targetText: string,
  options: UseSmoothStreamingOptions = {}
) {
  const {
    charsPerTick = 3,
    tickInterval = 16, // ~60fps
    isStreaming = true,
    onComplete,
    adaptiveSpeed = true,
    maxCatchUpChars = 20,
  } = options

  // Respect reduced-motion preference: skip character-by-character reveal
  const prefersReducedMotion = useMemo(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  [])

  const [displayedText, setDisplayedText] = useState("")
  const displayedLengthRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)
  const completedRef = useRef(false)
  const targetTextRef = useRef(targetText)

  // Keep targetText in a ref to avoid closure issues
  targetTextRef.current = targetText

  const animate = useCallback((timestamp: number) => {
    // Throttle updates based on tickInterval
    if (timestamp - lastTickRef.current < tickInterval) {
      animationFrameRef.current = requestAnimationFrame(animate)
      return
    }
    lastTickRef.current = timestamp

    const currentLength = displayedLengthRef.current
    const targetLength = targetTextRef.current.length

    if (currentLength < targetLength) {
      // Calculate how many chars to add
      let charsToAdd = charsPerTick

      if (adaptiveSpeed) {
        const behind = targetLength - currentLength
        // Smooth adaptive catch-up: use behind/3 for faster convergence
        // This prevents the "stuck then burst" feeling
        charsToAdd = Math.min(
          Math.max(charsPerTick, Math.ceil(behind / 3)),
          maxCatchUpChars
        )
      }

      const newLength = Math.min(currentLength + charsToAdd, targetLength)
      displayedLengthRef.current = newLength
      setDisplayedText(targetTextRef.current.slice(0, newLength))

      animationFrameRef.current = requestAnimationFrame(animate)
    } else if (!completedRef.current && !isStreaming) {
      // Streaming done and we've caught up
      completedRef.current = true
      onComplete?.()
      // Don't schedule another frame -- we're done
    }
    // When caught up but still streaming, let the loop stop.
    // The useEffect watching targetText will restart it when new content arrives.
  }, [charsPerTick, tickInterval, isStreaming, onComplete, adaptiveSpeed, maxCatchUpChars])

  useEffect(() => {
    // If user prefers reduced motion, skip animation entirely
    if (prefersReducedMotion) {
      displayedLengthRef.current = targetText.length
      setDisplayedText(targetText)
      if (!isStreaming && !completedRef.current) {
        completedRef.current = true
        onComplete?.()
      }
      return
    }

    // Reset completion state when text changes
    if (targetText.length > 0) {
      completedRef.current = false
    }

    // Start animation
    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [animate, targetText, prefersReducedMotion, isStreaming, onComplete])

  // When streaming stops, smoothly catch up to the end
  useEffect(() => {
    if (!isStreaming && displayedLengthRef.current < targetText.length) {
      // Use rAF for smoother catch-up instead of fixed delay
      const raf = requestAnimationFrame(() => {
        displayedLengthRef.current = targetText.length
        setDisplayedText(targetText)
        if (!completedRef.current) {
          completedRef.current = true
          onComplete?.()
        }
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [isStreaming, targetText, onComplete])

  const progress = useMemo(() =>
    targetText.length > 0 ? displayedLengthRef.current / targetText.length : 1,
    [targetText.length]
  )

  return {
    displayedText,
    isComplete: displayedLengthRef.current >= targetText.length && !isStreaming,
    progress,
    /** Number of characters displayed */
    displayedLength: displayedLengthRef.current,
    /** Total characters in target text */
    targetLength: targetText.length,
  }
}

/**
 * Typing cursor effect - visibility driven by CSS .animate-smooth-blink
 * No JS interval needed; the CSS animation handles the blink.
 */
export function useTypingCursor(isTyping: boolean) {
  // Cursor visibility is handled by CSS .animate-smooth-blink
  // No need for a JS setInterval that causes React re-renders every 530ms
  return isTyping ? "|" : ""
}

/**
 * Word-by-word streaming hook
 * Reveals text word by word instead of character by character
 */
export function useWordStreaming(
  targetText: string,
  options: {
    wordsPerTick?: number
    tickInterval?: number
    isStreaming?: boolean
    onComplete?: () => void
  } = {}
) {
  const {
    wordsPerTick = 1,
    tickInterval = 50,
    isStreaming = true,
    onComplete,
  } = options

  const words = useMemo(() => targetText.split(/(\s+)/), [targetText])
  const [displayedWordCount, setDisplayedWordCount] = useState(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)
  const completedRef = useRef(false)

  const animate = useCallback((timestamp: number) => {
    if (timestamp - lastTickRef.current < tickInterval) {
      animationFrameRef.current = requestAnimationFrame(animate)
      return
    }
    lastTickRef.current = timestamp

    setDisplayedWordCount((prev) => {
      const next = Math.min(prev + wordsPerTick, words.length)
      if (next >= words.length && !completedRef.current && !isStreaming) {
        completedRef.current = true
        onComplete?.()
      }
      return next
    })

    if (isStreaming || displayedWordCount < words.length) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
  }, [words.length, wordsPerTick, tickInterval, isStreaming, onComplete, displayedWordCount])

  useEffect(() => {
    completedRef.current = false
    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [animate])

  useEffect(() => {
    if (!isStreaming) {
      setDisplayedWordCount(words.length)
    }
  }, [isStreaming, words.length])

  const displayedText = words.slice(0, displayedWordCount).join("")

  return {
    displayedText,
    isComplete: displayedWordCount >= words.length && !isStreaming,
    progress: words.length > 0 ? displayedWordCount / words.length : 1,
  }
}

/**
 * Smooth scroll-to-bottom hook
 * Automatically scrolls to bottom during streaming but allows user override
 */
export function useAutoScroll(
  containerRef: React.RefObject<HTMLElement | null>,
  isStreaming: boolean,
  threshold: number = 100
) {
  const userScrolledUpRef = useRef(false)
  const lastScrollTopRef = useRef(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight

      // Detect if user scrolled up
      if (scrollTop < lastScrollTopRef.current && distanceFromBottom > threshold) {
        userScrolledUpRef.current = true
      }

      // Reset if user scrolls back to bottom
      if (distanceFromBottom <= threshold) {
        userScrolledUpRef.current = false
      }

      lastScrollTopRef.current = scrollTop
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [containerRef, threshold])

  // Auto-scroll during streaming (unless user scrolled up)
  useEffect(() => {
    if (!isStreaming || userScrolledUpRef.current) return

    const container = containerRef.current
    if (!container) return

    let rafId: number
    let lastScrollTime = 0

    const scrollToBottom = (timestamp: number) => {
      // Throttle to ~15fps for scroll (every 66ms) - smooth enough, less CPU
      if (timestamp - lastScrollTime > 66) {
        lastScrollTime = timestamp
        if (!userScrolledUpRef.current) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          })
        }
      }
      rafId = requestAnimationFrame(scrollToBottom)
    }

    rafId = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(rafId)
  }, [containerRef, isStreaming])

  return {
    scrollToBottom: () => {
      userScrolledUpRef.current = false
      containerRef.current?.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      })
    },
    isUserScrolledUp: userScrolledUpRef.current,
  }
}
