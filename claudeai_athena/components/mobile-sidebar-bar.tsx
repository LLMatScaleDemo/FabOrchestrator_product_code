"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"

/**
 * The phone's way into the conversation sidebar.
 *
 * Below 768px `components/ui/sidebar.tsx` turns the sidebar into a drawer (a
 * Radix `Sheet`) that starts closed, and the sidebar's own `SidebarTrigger`
 * sits in its header — inside that closed drawer. With nothing outside it, a
 * phone had no way to reach the conversation list, New chat, Dashboard,
 * Settings or Log out.
 *
 * This bar is that way in: the same `SidebarTrigger` and the same wordmark the
 * sidebar header shows, in normal flow at the top of the content so it covers
 * nothing. Callers give the content below it `min-h-0 flex-1` rather than
 * `h-full`, so the bar takes its height from the content instead of pushing
 * the composer off the bottom of the screen.
 *
 * At its right is the sidebar header's other control, **Back to overview** —
 * the same label, glyph and destination (`router.push("/home")`) — so the way
 * back to the cockpit is on screen while the drawer is shut, not only inside
 * it.
 *
 * `md:hidden` rather than `useIsMobile()`: Tailwind's `md` starts at 768px,
 * the same number as `MOBILE_BREAKPOINT`, so the bar and the drawer switch at
 * exactly the same width and there is no first-render flash while the hook
 * resolves. At 768px and above it is `display: none` and the desktop layout is
 * what it was — the rail carries both controls there.
 */
export function MobileSidebarBar() {
  const router = useRouter()
  return (
    <div className="bg-background flex h-12 shrink-0 items-center gap-1.5 border-b px-2 md:hidden">
      <SidebarTrigger className="size-10 shrink-0" />
      <span className="truncate text-[16px] font-bold tracking-[-0.2px]">
        FabOrchestrator<span style={{ color: "var(--chat-brand-blue)" }}>.ai</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => router.push("/home")}
        aria-label="Back to FabOrchestrator overview"
        title="Back to overview"
        className="text-muted-foreground hover:text-foreground ml-auto size-10 shrink-0"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </Button>
    </div>
  )
}
