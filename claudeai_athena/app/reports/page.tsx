"use client"

/**
 * Recent Reports — the pinned dashboards section.
 *
 * Readable by every role; only an admin can pin or remove. Nothing here is a
 * stored snapshot: opening a report re-runs that dashboard's SQL through
 * `/api/fabinsight/render`, so what you see is the environment as it is now.
 *
 * Uses the cockpit shell (nav, Plus Jakarta Sans, 1180px column, card tokens)
 * so it reads as part of FabOrchestrator rather than a bolted-on page.
 */

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CockpitNav } from "@/components/cockpit/cockpit-nav"
import { COCKPIT_FONT } from "@/components/cockpit/cockpit-page"
import { PageLoadingSkeleton } from "@/components/ui/skeleton-loaders"
import type { AuthedUser } from "@/app/home/page"

type Pinned = {
  id: string
  title: string
  dashboardId: string
  kind?: string
  params: Record<string, string>
  createdAt: string
  createdBy: string
  refreshedAt: string | null
  hasCache: boolean
}

const AUTH_TOKEN_KEY = "llmatscale_auth_token"

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem(AUTH_TOKEN_KEY) : null
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

/** Timestamp → UTC, labelled (matches the stamp baked into the dashboard). */
function formatStamp(iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC",
    }) + " UTC"
  } catch {
    return ""
  }
}

function Icon({ d, className = "h-[15px] w-[15px]" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const CARD_STYLE = {
  borderColor: "var(--border-light)",
  boxShadow: "0 2px 10px rgba(22,28,52,.05)",
} as const

export default function ReportsPage() {
  const router = useRouter()
  const [user, setUser] = useState<AuthedUser | null>(null)
  const [ready, setReady] = useState(false)

  const [items, setItems] = useState<Pinned[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [open, setOpen] = useState<Pinned | null>(null)
  const [html, setHtml] = useState("")
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [isLive, setIsLive] = useState(false)
  const [noSnapshot, setNoSnapshot] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!localStorage.getItem(AUTH_TOKEN_KEY)) { router.replace("/"); return }
    fetch("/api/auth/me", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setUser(j?.user ?? null))
      .catch(() => {})
      .finally(() => setReady(true))
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/fabinsight/pinned", { headers: authHeaders() })
      if (res.status === 401) { router.replace("/"); return }
      const raw = await res.text()
      const json = raw ? JSON.parse(raw) : {}
      setItems(json.dashboards ?? [])
      setCanManage(!!json.canManage)
      setError(null)
    } catch {
      setError("Could not load pinned dashboards.")
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { void load() }, [load])

  /** Refresh button — a fresh LIVE query, bypassing the cached snapshot. */
  const renderPinned = useCallback(async (p: Pinned) => {
    setRendering(true)
    setRenderError(null)
    setNoSnapshot(false)
    try {
      // Custom dashboards have no live /render route — re-run them by id (which
      // re-executes their stored queries and updates the shared snapshot). The 7
      // recipes still render live via /render.
      const res =
        p.kind === "custom"
          ? await fetch(`/api/fabinsight/pinned/${p.id}/refresh`, { method: "POST", headers: authHeaders() })
          : await fetch("/api/fabinsight/render", {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify({ dashboardId: p.dashboardId, params: p.params ?? {} }),
            })
      const raw = await res.text()
      const json = raw ? (JSON.parse(raw) as { html?: string; refreshedAt?: string; error?: string }) : {}
      if (!res.ok) throw new Error(json.error ?? `Could not load live data (${res.status}).`)
      setHtml(json.html ?? "")
      setRefreshedAt(formatStamp(json.refreshedAt ?? new Date().toISOString()))
      setIsLive(true)
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : "Could not load live data.")
      setHtml("")
    } finally {
      setRendering(false)
    }
  }, [])

  /**
   * Open — show ONLY the shared scheduled SNAPSHOT (cached HTML). Opening a
   * report NEVER hits the MES; live data is fetched exclusively by the Refresh
   * button. A pin with no snapshot yet (brand-new, before its first scheduled
   * run) shows a "not refreshed yet" prompt rather than auto-querying live.
   */
  const openReport = useCallback(async (p: Pinned) => {
    setOpen(p); setHtml(""); setRefreshedAt(null); setRenderError(null); setIsLive(false); setNoSnapshot(false)
    setRendering(true)
    try {
      const res = await fetch(`/api/fabinsight/pinned/${p.id}`, { headers: authHeaders() })
      const raw = await res.text()
      const json = raw ? (JSON.parse(raw) as { html?: string | null; refreshedAt?: string | null }) : {}
      if (res.ok && json.html) {
        setHtml(json.html)
        setRefreshedAt(formatStamp(json.refreshedAt))
        setIsLive(false)
      } else {
        // No snapshot yet — do NOT auto-refresh live; wait for the button.
        setNoSnapshot(true)
      }
    } catch {
      setNoSnapshot(true)
    } finally {
      setRendering(false)
    }
  }, [])

  const remove = useCallback(async (p: Pinned) => {
    if (!confirm(`Remove “${p.title}” from Recent Reports?`)) return
    const res = await fetch(`/api/fabinsight/pinned/${p.id}`, { method: "DELETE", headers: authHeaders() })
    if (res.ok) {
      setItems((prev) => prev.filter((x) => x.id !== p.id))
      if (open?.id === p.id) setOpen(null)
    } else {
      const raw = await res.text()
      alert((raw ? JSON.parse(raw).error : null) ?? "Could not remove this dashboard.")
    }
  }, [open])

  const download = useCallback(() => {
    if (!html || !open) return
    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${open.title.replace(/[^\w-]+/g, "-").toLowerCase()}.html`
    a.click()
    URL.revokeObjectURL(url)
  }, [html, open])

  const subtitle = (p: Pinned) => {
    if (p.kind === "custom") return "Custom dashboard"
    const bits = [p.dashboardId.replace(/-/g, " ")]
    if (p.params?.lot) bits.push(`lot ${p.params.lot}`)
    if (p.params?.product) bits.push(`product ${p.params.product}`)
    return bits.join(" · ")
  }

  const btn = "flex items-center gap-[6px] rounded-[9px] border px-[11px] py-[7px] text-[12.5px] font-semibold transition-colors disabled:opacity-50"

  if (!ready) return <PageLoadingSkeleton />

  return (
    <div
      className="cockpit-v2 h-full overflow-y-auto"
      style={{ fontFamily: COCKPIT_FONT, background: "var(--page-surface)", color: "var(--text-ink)", lineHeight: "normal" }}
    >
      <CockpitNav user={user} />

      <div className="mx-auto w-full max-w-[1180px] px-[26px] pb-[48px] pt-[38px]">
        {open ? (
          <>
            {/* ── One report, live ─────────────────────────────────────── */}
            <button onClick={() => setOpen(null)}
              className="mb-[14px] flex items-center gap-[5px] text-[13px] font-semibold"
              style={{ color: "var(--brand-indigo)" }}>
              <Icon d="M15 18l-6-6 6-6" className="h-[14px] w-[14px]" /> All reports
            </button>

            <div className="mb-[18px] flex flex-wrap items-end gap-[11px]">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[22px] font-extrabold tracking-[-0.4px]">{open.title}</h1>
                <p className="mt-[3px] text-[12.5px] capitalize" style={{ color: "var(--text-muted-cool)" }}>
                  {subtitle(open)}
                  {refreshedAt && (
                    <span className="normal-case">
                      {" · "}{isLive ? "Live" : "Snapshot"} · Last refreshed {refreshedAt}
                    </span>
                  )}
                </p>
              </div>
              <button onClick={() => void renderPinned(open)} disabled={rendering}
                className={btn} style={{ ...CARD_STYLE, background: "#fff" }}>
                <Icon d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" className={`h-[14px] w-[14px] ${rendering ? "animate-spin" : ""}`} />
                {rendering ? "Refreshing…" : "Refresh"}
              </button>
              <button onClick={download} disabled={!html} className={btn} style={{ ...CARD_STYLE, background: "#fff" }}>
                <Icon d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" className="h-[14px] w-[14px]" /> Download
              </button>
              {canManage && (
                <button onClick={() => void remove(open)} className={btn}
                  style={{ ...CARD_STYLE, background: "#fff", color: "var(--status-red, #d33)" }}>
                  <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" className="h-[14px] w-[14px]" /> Remove
                </button>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border bg-white" style={CARD_STYLE}>
              {rendering && !html && (
                <div className="flex h-[520px] items-center justify-center text-[13px]" style={{ color: "var(--text-muted-cool)" }}>
                  {isLive ? "Querying live manufacturing data…" : "Loading snapshot…"}
                </div>
              )}
              {noSnapshot && !rendering && !html && !renderError && (
                <div className="flex h-[520px] flex-col items-center justify-center gap-[6px] px-6 text-center">
                  <p className="text-[13.5px] font-bold">No snapshot yet</p>
                  <p className="text-[12.5px]" style={{ color: "var(--text-muted-cool)" }}>
                    This report hasn’t been refreshed yet. Click <span className="font-semibold">Refresh</span> to load live data.
                  </p>
                </div>
              )}
              {renderError && (
                <div className="flex h-[520px] flex-col items-center justify-center gap-[6px] px-6 text-center">
                  <p className="text-[13.5px] font-bold">{renderError}</p>
                  <p className="text-[12.5px]" style={{ color: "var(--text-muted-cool)" }}>
                    The report is still saved — try refreshing in a moment.
                  </p>
                </div>
              )}
              {html && (
                <iframe srcDoc={html} title={open.title} className="h-[calc(100vh-260px)] min-h-[520px] w-full border-0"
                  sandbox="allow-same-origin allow-scripts" />
              )}
            </div>
          </>
        ) : (
          <>
            {/* ── The list ─────────────────────────────────────────────── */}
            <button type="button" onClick={() => router.push("/chat")}
              className="mb-[14px] flex items-center gap-[5px] text-[13px] font-semibold"
              style={{ color: "var(--brand-indigo)" }}>
              <Icon d="M15 18l-6-6 6-6" className="h-[14px] w-[14px]" /> Back to chat
            </button>

            <div className="mb-[18px] flex items-center gap-[11px]">
              <span className="text-[18px] font-extrabold tracking-[-0.3px]">Recent Reports</span>
              <span className="rounded-[7px] px-[9px] py-[3px] text-[10.5px] font-bold tracking-[0.06em]"
                style={{ color: "var(--brand-indigo)", background: "var(--brand-indigo-bg)" }}>
                {items.length} PINNED
              </span>
            </div>
            <p className="mb-[22px] text-[12.5px]" style={{ color: "var(--text-muted-cool)" }}>
              Dashboards pinned by an administrator. Reports refresh automatically on a schedule — opening shows the
              latest shared snapshot; use Refresh inside a report for live data.
            </p>

            {loading && <p className="text-[13px]" style={{ color: "var(--text-muted-cool)" }}>Loading…</p>}
            {error && <p className="text-[13px] font-semibold" style={{ color: "var(--status-red, #d33)" }}>{error}</p>}

            {!loading && !error && items.length === 0 && (
              <div className="rounded-2xl border bg-white px-6 py-[54px] text-center" style={CARD_STYLE}>
                <div className="mx-auto mb-[14px] flex h-[42px] w-[42px] items-center justify-center rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg,var(--brand-indigo),var(--cockpit-indigo))", boxShadow: "0 5px 14px rgba(91,84,232,.3)" }}>
                  <Icon d="M6 20V13M12 20V8M18 20V11" className="h-[19px] w-[19px]" />
                </div>
                <p className="text-[15px] font-bold">No pinned dashboards yet</p>
                <p className="mx-auto mt-[6px] max-w-[440px] text-[12.5px] leading-[1.5]" style={{ color: "var(--text-muted-cool)" }}>
                  {canManage
                    ? "Generate a dashboard in the chat, then choose Pin in the dashboard panel to save it here for everyone."
                    : "An administrator has not pinned any dashboards yet. Once they do, they appear here for every role."}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => (
                <div key={p.id} onClick={() => openReport(p)}
                  className="group flex cursor-pointer flex-col rounded-2xl border bg-white p-[18px] transition-all hover:-translate-y-[3px]"
                  style={CARD_STYLE}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[9.5px] font-bold tracking-[0.14em]" style={{ color: "var(--text-subtle)" }}>
                      LIVE REPORT
                    </div>
                    {canManage && (
                      <button onClick={(e) => { e.stopPropagation(); void remove(p) }} aria-label={`Remove ${p.title}`}
                        className="rounded p-1 opacity-0 transition group-hover:opacity-100"
                        style={{ color: "var(--text-muted-cool)" }}>
                        <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" className="h-[14px] w-[14px]" />
                      </button>
                    )}
                  </div>

                  <div className="my-[10px] mb-[14px] flex h-[42px] w-[42px] items-center justify-center rounded-xl text-white"
                    style={{ background: "linear-gradient(135deg,var(--brand-indigo),var(--cockpit-indigo))", boxShadow: "0 5px 14px rgba(91,84,232,.3)" }}>
                    <Icon d="M6 20V13M12 20V8M18 20V11" className="h-[19px] w-[19px]" />
                  </div>

                  <div className="text-[16px] font-bold leading-[1.25]">{p.title}</div>
                  <div className="mt-[3px] text-[9.5px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--brand-indigo)" }}>
                    {p.dashboardId.replace(/-/g, " ")}
                  </div>
                  <div className="mt-2.5 min-h-[36px] text-[12.5px] leading-[1.5]" style={{ color: "var(--text-muted-cool)" }}>
                    {p.params?.lot ? `Lot ${p.params.lot}` : p.params?.product ? `Product ${p.params.product}` : "Fab-wide"}
                    {" · "}Pinned by {p.createdBy}
                    <br />
                    {p.hasCache && p.refreshedAt
                      ? `Refreshed ${formatStamp(p.refreshedAt)}`
                      : "Not yet refreshed"}
                  </div>

                  <div className="mt-[14px] flex items-center gap-1.5 text-[13px] font-bold transition-colors group-hover:text-[var(--cockpit-indigo)]"
                    style={{ color: "var(--brand-indigo)" }}>
                    Open <Icon d="M9 6l6 6-6 6" className="h-[13px] w-[13px]" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
