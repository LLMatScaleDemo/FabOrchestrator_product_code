"use client"

import * as React from "react"
import { Clock, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface SessionExpiredModalProps {
  open: boolean
  autoRedirectSeconds?: number
  redirectTo?: string
  storageKeys?: string[]
}

/**
 * Friendly full-screen overlay for the admin app. Same UX as the
 * Athena modal — but in admin we only see this if the 30-day absolute
 * expiry hits (idle eviction is disabled for admin sessions).
 */
export function SessionExpiredModal({
  open,
  autoRedirectSeconds = 5,
  redirectTo = "/",
  storageKeys = ["admin_athena_token", "admin_athena_user", "admin_athena_session"],
}: SessionExpiredModalProps) {
  const [secondsLeft, setSecondsLeft] = React.useState(autoRedirectSeconds)

  React.useEffect(() => {
    if (!open) return
    setSecondsLeft(autoRedirectSeconds)
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [open, autoRedirectSeconds])

  React.useEffect(() => {
    if (!open) return
    if (secondsLeft > 0) return
    redirectNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, open])

  React.useEffect(() => {
    if (!open) return
    document.documentElement.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = ""
    }
  }, [open])

  const redirectNow = React.useCallback(() => {
    try {
      for (const k of storageKeys) localStorage.removeItem(k)
    } catch {/* ignore */}
    if (typeof window !== "undefined") {
      window.location.href = redirectTo
    }
  }, [redirectTo, storageKeys])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="session-expired-title"
      className="fixed inset-0 z-[100] flex items-center justify-center"
    >
      <div className="absolute inset-0 bg-background/85 backdrop-blur-md" />
      <div
        className={cn(
          "relative z-10 w-full max-w-md mx-4 rounded-2xl border border-border bg-card text-card-foreground shadow-2xl",
          "p-8 text-center animate-in fade-in zoom-in-95 duration-200"
        )}
      >
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40">
          <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" strokeWidth={1.8} />
        </div>
        <h2 id="session-expired-title" className="text-xl font-semibold tracking-tight">
          You&apos;ve been signed out
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Your admin session has ended. Please sign in again to continue.
        </p>
        <p className="mt-5 text-xs text-muted-foreground/80">
          {secondsLeft > 0 ? (
            <>Redirecting to sign in in <span className="font-mono font-semibold text-foreground">{secondsLeft}s</span>…</>
          ) : (
            <>Redirecting…</>
          )}
        </p>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-amber-500 dark:bg-amber-400 transition-[width] duration-1000 ease-linear"
            style={{ width: `${(secondsLeft / autoRedirectSeconds) * 100}%` }}
          />
        </div>
        <Button
          type="button"
          size="lg"
          className="mt-6 w-full gap-2"
          onClick={redirectNow}
        >
          <LogIn className="h-4 w-4" />
          Log in now
        </Button>
      </div>
    </div>
  )
}
