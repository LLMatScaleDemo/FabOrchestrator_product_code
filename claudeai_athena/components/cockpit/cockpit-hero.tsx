export function CockpitHero() {
    return (
        <div className="text-center">
            <span
                className="inline-flex items-center gap-[7px] rounded-[20px] px-[13px] py-[6px] text-[11px] font-bold tracking-[0.08em]"
                style={{ color: "#1fa971", background: "#e7f7ef" }}
            >
                <span
                    className="inline-block h-[7px] w-[7px] rounded-full"
                    style={{ background: "#1fa971", boxShadow: "0 0 0 3px rgba(31,169,113,.18)" }}
                />
                ALL AGENTS ONLINE
            </span>

            <h1 className="mt-4 text-[42px] font-extrabold tracking-[-1px]">
                Your{" "}
                <span
                    style={{
                        background: "linear-gradient(120deg,#6f73ff,#4842d4)",
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                    }}
                >
                    orchestration
                </span>{" "}
                cockpit.
            </h1>

            <div className="mt-2.5 text-[15px] font-medium" style={{ color: "#5d6680" }}>
                Unify systems. Automate workflows. Transform the enterprise.
            </div>
        </div>
    )
}
