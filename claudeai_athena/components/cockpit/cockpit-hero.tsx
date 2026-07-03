export function CockpitHero() {
    return (
        <div className="text-center">
            <span
                className="inline-flex items-center gap-[7px] rounded-[20px] px-[13px] py-[6px] text-[11px] font-bold tracking-[0.08em]"
                style={{ color: "var(--status-green)", background: "var(--status-green-bg)" }}
            >
                <span
                    className="inline-block h-[7px] w-[7px] rounded-full"
                    style={{ background: "var(--status-green)", boxShadow: "0 0 0 3px rgba(31,169,113,.18)" }}
                />
                ALL AGENTS ONLINE
            </span>

            <h1 className="mt-4 text-[42px] font-extrabold tracking-[-1px]">
                Your{" "}
                <span
                    style={{
                        background: "linear-gradient(120deg,var(--brand-indigo-light),var(--cockpit-indigo))",
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                    }}
                >
                    orchestration
                </span>{" "}
                cockpit.
            </h1>

            <div className="mt-2.5 text-[15px] font-medium" style={{ color: "var(--text-muted-cool)" }}>
                Unify systems. Automate workflows. Transform the enterprise.
            </div>
        </div>
    )
}
