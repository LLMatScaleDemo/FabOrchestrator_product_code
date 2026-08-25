"use client"

import * as React from "react"

const sv = (children: React.ReactNode, size: number, sw = 2) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        {children}
    </svg>
)

const KPIS: { label: string; icon: React.ReactNode; value: string; delta: string; tone: string }[] = [
    { label: "Workflows", icon: sv(<><circle cx="6" cy="6" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="6" cy="18" r="2" /><path d="M8 6h5a3 3 0 0 1 3 3v.4M8 18h5a3 3 0 0 0 3-3v-.4" /></>, 13), value: "142", delta: "↑ 12%", tone: "var(--status-green)" },
    { label: "Automated", icon: sv(<><circle cx="12" cy="12" r="9" /><polyline points="9 12 11 14 15 9" /></>, 13), value: "8,394", delta: "↑ 23%", tone: "var(--status-green)" },
    { label: "Alerts", icon: sv(<path d="M10.3 3.2a9 9 0 1 0 10.5 10.5A7 7 0 0 1 10.3 3.2z" />, 13), value: "7", delta: "3 to review", tone: "var(--status-amber)" },
    { label: "Time saved", icon: sv(<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" /></>, 13), value: "62%", delta: "vs Q3", tone: "var(--text-[var(--text-subtle)])" },
]

const ACTIVITY: { icon: React.ReactNode; name: string; desc: string; ago: string; pulse?: boolean }[] = [
    { icon: sv(<><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="12" r="2.2" /><path d="M8.2 6H13a3 3 0 0 1 3 3v.4" /><path d="M8.2 18H13a3 3 0 0 0 3-3v-.4" /></>, 16), name: "FabInsight™", desc: "Yield anomaly flagged on Line 4", ago: "2 min", pulse: true },
    { icon: sv(<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2-2z" />, 16), name: "AI Support", desc: "42 escalations resolved", ago: "18 min" },
    { icon: sv(<><circle cx="7" cy="7" r="2.4" /><circle cx="17" cy="17" r="2.4" /><path d="M9.4 7H15a2 2 0 0 1 2 2v5.6" /></>, 16), name: "Master Data Load Agent", desc: "Fab West Phase 2 live", ago: "1 hr" },
    { icon: sv(<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>, 16), name: "Back-end Agent", desc: "6 connectors deployed", ago: "3 hr" },
]

export function CockpitFooterStats() {
    return (
        <div className="mt-[34px] grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
            {/* Live ops */}
            <div className="rounded-2xl border bg-white px-5 py-[18px]" style={{ borderColor: "var(--border-light)", boxShadow: "0 2px 10px rgba(22,28,52,.05)" }}>
                <div className="mb-[14px] flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[14.5px] font-bold">
                        <span className="flex" style={{ color: "var(--brand-indigo)" }}>{sv(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />, 17)}</span>
                        Live ops
                    </span>
                    <span className="text-[12.5px] font-semibold" style={{ color: "var(--brand-indigo)" }}>Dashboard →</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    {KPIS.map((k) => (
                        <div key={k.label} className="rounded-xl px-[15px] py-[14px]" style={{ background: "var(--cockpit-surface)" }}>
                            <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted-cool)" }}>
                                {k.icon}
                                {k.label}
                            </div>
                            <div className="mt-[7px] text-[27px] font-extrabold tracking-[-0.6px]">{k.value}</div>
                            <div className="mt-[3px] text-[11.5px] font-semibold" style={{ color: k.tone }}>{k.delta}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Recent activity */}
            <div className="rounded-2xl border bg-white px-5 py-[18px]" style={{ borderColor: "var(--border-light)", boxShadow: "0 2px 10px rgba(22,28,52,.05)" }}>
                <div className="mb-[14px] flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[14.5px] font-bold">
                        <span className="flex" style={{ color: "var(--brand-indigo)" }}>{sv(<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>, 17)}</span>
                        Recent activity
                    </span>
                    <span className="text-[12.5px] font-semibold" style={{ color: "var(--brand-indigo)" }}>All →</span>
                </div>
                <div className="flex flex-col gap-[3px]">
                    {ACTIVITY.map((a, i) => (
                        <div key={i} className="flex cursor-pointer items-center gap-3 rounded-[10px] px-2 py-[9px] transition-colors hover:bg-[var(--cockpit-surface)]">
                            <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] text-white" style={{ background: "linear-gradient(135deg,var(--brand-indigo),var(--cockpit-indigo))" }}>
                                {a.icon}
                            </span>
                            <span className="flex-1" style={{ lineHeight: 1.3 }}>
                                <span className="block text-[13px] font-bold">{a.name}</span>
                                <span className="block text-[12px]" style={{ color: "var(--text-muted-cool)" }}>{a.desc}</span>
                            </span>
                            {a.pulse && <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: "var(--status-green)", boxShadow: "0 0 0 3px rgba(31,169,113,.16)" }} />}
                            <span className="whitespace-nowrap text-[11px] font-semibold" style={{ color: "var(--text-[var(--text-subtle)])" }}>{a.ago}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
