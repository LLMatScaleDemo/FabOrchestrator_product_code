"use client"

import { useEffect, useCallback, useRef } from "react"

export interface KeyboardShortcut {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  description: string
  action: () => void
}

export interface UseKeyboardShortcutsOptions {
  enabled?: boolean
  shortcuts: KeyboardShortcut[]
}

/**
 * Custom hook for managing keyboard shortcuts
 *
 * @example
 * ```tsx
 * useKeyboardShortcuts({
 *   shortcuts: [
 *     { key: 'k', ctrlKey: true, description: 'New chat', action: handleNewChat },
 *     { key: 'Escape', description: 'Clear input', action: handleClearInput },
 *   ],
 * })
 * ```
 */
export function useKeyboardShortcuts({
  enabled = true,
  shortcuts,
}: UseKeyboardShortcutsOptions) {
  const shortcutsRef = useRef(shortcuts)

  // Update ref when shortcuts change
  useEffect(() => {
    shortcutsRef.current = shortcuts
  }, [shortcuts])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return

      // Don't trigger shortcuts when typing in inputs (except Escape)
      const target = event.target as HTMLElement
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable

      for (const shortcut of shortcutsRef.current) {
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase()
        const ctrlMatches = shortcut.ctrlKey ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey
        const shiftMatches = shortcut.shiftKey ? event.shiftKey : !event.shiftKey
        const altMatches = shortcut.altKey ? event.altKey : !event.altKey

        // Special handling for modifier key shortcuts (Ctrl/Cmd)
        const hasModifier = shortcut.ctrlKey || shortcut.metaKey || shortcut.altKey

        // Allow Escape to work even when typing
        const isEscape = shortcut.key.toLowerCase() === "escape"

        if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
          // If typing and it's not Escape and no modifier, skip
          if (isTyping && !isEscape && !hasModifier) {
            continue
          }

          event.preventDefault()
          shortcut.action()
          return
        }
      }
    },
    [enabled]
  )

  useEffect(() => {
    if (!enabled) return

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [enabled, handleKeyDown])

  return {
    shortcuts: shortcutsRef.current,
  }
}

/**
 * Get the keyboard shortcut display string (e.g., "⌘K" or "Ctrl+K")
 */
export function getShortcutDisplay(shortcut: KeyboardShortcut): string {
  const parts: string[] = []
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  if (shortcut.ctrlKey || shortcut.metaKey) {
    parts.push(isMac ? "⌘" : "Ctrl")
  }
  if (shortcut.shiftKey) {
    parts.push(isMac ? "⇧" : "Shift")
  }
  if (shortcut.altKey) {
    parts.push(isMac ? "⌥" : "Alt")
  }

  // Format key name
  let keyName = shortcut.key
  if (keyName === " ") keyName = "Space"
  if (keyName === "Escape") keyName = "Esc"
  if (keyName === "ArrowUp") keyName = "↑"
  if (keyName === "ArrowDown") keyName = "↓"
  if (keyName === "ArrowLeft") keyName = "←"
  if (keyName === "ArrowRight") keyName = "→"
  if (keyName === "Enter") keyName = "↵"
  if (keyName.length === 1) keyName = keyName.toUpperCase()

  parts.push(keyName)

  return isMac ? parts.join("") : parts.join("+")
}

// Common keyboard shortcuts for chat applications
export const CHAT_SHORTCUTS = {
  newChat: { key: "k", ctrlKey: true, description: "New chat" },
  clearInput: { key: "Escape", description: "Clear input / Close panel" },
  focusInput: { key: "/", description: "Focus input" },
  toggleSidebar: { key: "b", ctrlKey: true, description: "Toggle sidebar" },
  openSettings: { key: ",", ctrlKey: true, description: "Open settings" },
  search: { key: "f", ctrlKey: true, description: "Search conversations" },
  copyLastResponse: { key: "c", ctrlKey: true, shiftKey: true, description: "Copy last response" },
  regenerate: { key: "r", ctrlKey: true, shiftKey: true, description: "Regenerate response" },
} as const

export type ChatShortcutKey = keyof typeof CHAT_SHORTCUTS
