"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AuthedUser } from "@/app/home/page"

const AUTH_SESSION_KEY = "llmatscale_auth_session"
const AUTH_TOKEN_KEY = "llmatscale_auth_token"

const sv = (children: React.ReactNode, size = 16) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {children}
    </svg>
)

const NAV_ITEMS: { label: string; active?: boolean; href?: string; icon: React.ReactNode }[] = [
    { label: "Cockpit", active: true, href: "/home", icon: sv(<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>) },
    { label: "Agents", icon: sv(<><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>) },
    { label: "Workflows", icon: sv(<><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="12" r="2.2" /><path d="M8.2 6H13a3 3 0 0 1 3 3v.4" /><path d="M8.2 18H13a3 3 0 0 0 3-3v-.4" /></>) },
    { label: "Sites", icon: sv(<><path d="M4 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15" /><path d="M15 9h4a1 1 0 0 1 1 1v11" /><line x1="7.5" y1="9" x2="11" y2="9" /></>) },
    { label: "Reports", href: "/reports", icon: sv(<><line x1="6" y1="20" x2="6" y2="13" /><line x1="12" y1="20" x2="12" y2="8" /><line x1="18" y1="20" x2="18" y2="11" /></>) },
]

const navIcon = (label: string) => NAV_ITEMS.find((item) => item.label === label)?.icon

/**
 * Device administration, when FabOrchestrator runs behind the FabOrchestrator
 * PWA (7 October 2026). The PWA approves the phones and computers that may
 * reach FabOrchestrator and manages them at its own page, `/device-admin`, on
 * the same origin. The button shows only when the PWA says this person is a
 * device administrator (`/api/pwa/device-admin/me`); FabOrchestrator on its own,
 * without the PWA, answers that with a 404 and the button never appears. A
 * whole-page navigation, not `router.push`: `/device-admin` is the PWA's page,
 * not one of FabOrchestrator's routes.
 */
const DEVICES_ICON = sv(<><rect x="7" y="2.5" width="10" height="19" rx="2" /><line x1="11" y1="18" x2="13" y2="18" /><path d="M3 9v6" /><path d="M21 9v6" /></>)
const DEVICE_ADMIN_PAGE = "/device-admin"

function useDeviceAdmin(): boolean {
    const [admin, setAdmin] = React.useState(false)
    React.useEffect(() => {
        let cancelled = false
        const token = typeof window === "undefined" ? null : window.localStorage.getItem(AUTH_TOKEN_KEY)
        if (!token) return
        fetch("/api/pwa/device-admin/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
            .then((res) => {
                if (!cancelled && res.ok) setAdmin(true)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [])
    return admin
}

/**
 * The header's navigation below 768px — every phone view, browser or installed.
 *
 * The row of links (`hidden md:flex`, further down) does not fit a phone —
 * five labelled buttons are about 500px — so below 768px it collapses into a
 * menu behind a button at the left of this same header. The button is
 * `md:hidden`: the exact complement of the row, so at every width exactly one
 * of the two shows and the header never loses Home and Reports. The menu
 * offers the destinations that are pages: the cockpit, the chat, and Reports.
 * Agents, Workflows and Sites have no pages yet, so they are not offered.
 *
 * Chat is shown but disabled for now (11 September): it stays visible for
 * context and is announced as unavailable, not as a link.
 */
const MOBILE_NAV: { label: string; href: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { label: "Cockpit", href: "/home", icon: navIcon("Cockpit") },
    { label: "Chat", href: "/chat", icon: sv(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />), disabled: true },
    { label: "Reports", href: "/reports", icon: navIcon("Reports") },
]

function getInitials(name: string | null, email: string): string {
    if (name) {
        const parts = name.trim().split(/\s+/)
        return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || email[0]!.toUpperCase()
    }
    return email[0]!.toUpperCase()
}

export function CockpitNav({ user }: { user: AuthedUser | null }) {
    const router = useRouter()
    const pathname = usePathname()
    const initials = user ? getInitials(user.name, user.email) : "—"
    const displayName = user?.name || user?.email || "—"
    const roleName = user?.role?.name || "Business User"
    const deviceAdmin = useDeviceAdmin()

    const handleLogout = async () => {
        if (typeof window === "undefined") return
        const token = window.localStorage.getItem(AUTH_TOKEN_KEY)
        if (token) {
            try {
                await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } })
            } catch {
                // Ignore — still clear local storage and redirect.
            }
        }
        window.localStorage.removeItem(AUTH_SESSION_KEY)
        window.localStorage.removeItem(AUTH_TOKEN_KEY)
        window.localStorage.removeItem("llmatscale_user")
        router.push("/")
    }

    return (
        <div className="sticky top-0 z-20 flex items-center gap-1.5 border-b bg-white px-4 py-[14px] md:px-[26px]" style={{ borderColor: "var(--border-light)" }}>
            {/* Navigation below 768px. The link row further along is
                `hidden md:flex`; this menu is `md:hidden` — the exact
                complement, so exactly one of the two shows at every width, in
                a browser and in the installed app alike. */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" aria-label="Open navigation" className="-ml-1.5 flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[9px] border-0 bg-transparent p-0 transition-colors hover:bg-[var(--cockpit-surface)] active:scale-100 md:hidden" style={{ color: "var(--text-ink)" }}>
                        {sv(<><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></>, 20)}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                    {MOBILE_NAV.map((item) => {
                        const current = !item.disabled && pathname === item.href
                        return (
                            // `disabled` is Radix's own: `aria-disabled` and
                            // `data-disabled`, skipped by keyboard focus and
                            // never highlighted; FabOrchestrator's item styles
                            // it dimmed with no pointer events.
                            <DropdownMenuItem
                                key={item.href}
                                disabled={item.disabled}
                                onClick={item.disabled ? undefined : () => router.push(item.href)}
                                aria-current={current ? "page" : undefined}
                                className="gap-2.5 py-2.5 text-[14px] font-semibold"
                                style={current ? { color: "var(--brand-indigo)" } : undefined}
                            >
                                <span className="flex">{item.icon}</span>
                                {item.label}
                            </DropdownMenuItem>
                        )
                    })}
                    {deviceAdmin ? (
                        <DropdownMenuItem
                            onClick={() => window.location.assign(DEVICE_ADMIN_PAGE)}
                            className="gap-2.5 py-2.5 text-[14px] font-semibold"
                        >
                            <span className="flex">{DEVICES_ICON}</span>
                            Devices
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* brand */}
            <div className="mr-1 flex items-center gap-2.5 md:mr-[22px]">
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-[15px] font-extrabold text-white" style={{ background: "linear-gradient(135deg,var(--brand-indigo),var(--cockpit-indigo))" }}>
                    A
                </div>
                <div style={{ lineHeight: 1.05 }}>
                    <div className="text-[14.5px] font-bold">FabOrchestrator</div>
                    <div className="text-[9.5px] font-semibold tracking-[0.14em]" style={{ color: "var(--text-[var(--text-subtle)])" }}>ATHENATEC</div>
                </div>
            </div>

            {/* nav links */}
            <nav className="hidden items-center gap-1.5 md:flex">
                {/* Cockpit and Reports go to their pages; Agents, Workflows and
                    Sites have none yet and stay on the cockpit. */}
                {NAV_ITEMS.map((item) => (
                    <Button
                        key={item.label}
                        type="button"
                        variant="ghost"
                        onClick={() => router.push(item.href ?? "/home")}
                        className="flex h-auto items-center gap-[7px] rounded-[9px] border-0 bg-transparent px-[14px] py-2 text-[13.5px] font-semibold transition-colors hover:bg-transparent active:scale-100 dark:hover:bg-transparent"
                        style={item.active ? { background: "var(--cockpit-nav-active)", color: "var(--pure-white)" } : { color: "var(--text-muted-cool)" }}
                    >
                        <span className="flex">{item.icon}</span>
                        {item.label}
                    </Button>
                ))}
                {deviceAdmin ? (
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => window.location.assign(DEVICE_ADMIN_PAGE)}
                        className="flex h-auto items-center gap-[7px] rounded-[9px] border-0 bg-transparent px-[14px] py-2 text-[13.5px] font-semibold transition-colors hover:bg-transparent active:scale-100 dark:hover:bg-transparent"
                        style={{ color: "var(--text-muted-cool)" }}
                    >
                        <span className="flex">{DEVICES_ICON}</span>
                        Devices
                    </Button>
                ) : null}
            </nav>

            <div className="flex-1" />

            {/* util */}
            <div className="flex items-center gap-1.5">
                <Button type="button" variant="ghost" aria-label="Search" className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border-0 bg-transparent p-0 transition-colors hover:bg-[var(--cockpit-surface)] active:scale-100" style={{ color: "var(--text-muted-cool)" }}>
                    {sv(<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>, 18)}
                </Button>
                <Button type="button" variant="ghost" aria-label="Notifications" className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border-0 bg-transparent p-0 transition-colors hover:bg-[var(--cockpit-surface)] active:scale-100" style={{ color: "var(--text-muted-cool)" }}>
                    {sv(<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>, 18)}
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" className="ml-2 flex h-auto items-center gap-[9px] rounded-none border-0 bg-transparent border-l p-0 pl-[14px] hover:bg-transparent active:scale-100 dark:hover:bg-transparent focus:outline-none" style={{ borderColor: "var(--border-light)" }}>
                            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-[12px] font-bold text-white" style={{ background: "linear-gradient(135deg,var(--brand-indigo-light),var(--cockpit-indigo))" }}>
                                {initials}
                            </span>
                            <span className="hidden text-left md:block" style={{ lineHeight: 1.1 }}>
                                <span className="block text-[12.5px] font-bold">{displayName}</span>
                                <span className="block text-[10px] font-semibold" style={{ color: "var(--text-[var(--text-subtle)])" }}>{roleName}</span>
                            </span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="leading-tight">
                            <div className="text-sm font-semibold text-foreground">{displayName}</div>
                            {user?.email && <div className="text-xs font-normal text-muted-foreground">{user.email}</div>}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                            <LogOut className="mr-2 size-4" />
                            Log out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    )
}
