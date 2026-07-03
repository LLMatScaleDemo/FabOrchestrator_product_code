"use client";

/**
 * Reusable, theme-aware analytics charts for the admin dashboard + usage pages.
 * Colors come exclusively from the --chart-* CSS tokens (no hardcoded hex),
 * so they follow the active platform theme in both light and dark mode.
 *
 * Every chart: locale-formatted tooltips, a visible legend, labeled/subtle
 * gridded axes, an empty state, a loading skeleton and reduced-motion support.
 */

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";

/* ── Locale-aware formatters ─────────────────────────────────────────── */

/** Compact, abbreviated number (K/M/B) — for axes and stat tiles. */
export function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

/** Full, grouped integer (e.g. 1,234,567) — for tooltips and tables. */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString();
}

/** Compact currency (K-abbreviated) — for stat tiles and axes. */
export function fmtCurrency(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (Math.abs(n) >= 1_000)
    return `$${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Exact, localized USD — for tooltips where precision matters. */
export function fmtCurrencyExact(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n < 1 ? 4 : 2,
  });
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function shortDate(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ── Shared UI: reduced-motion, skeleton, empty state ────────────────── */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "w-full animate-pulse rounded-lg bg-muted/60 motion-reduce:animate-none",
        className
      )}
      aria-hidden="true"
    />
  );
}

export function ChartEmpty({
  message = "No data yet",
  hint,
  className,
}: {
  message?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 text-center",
        className
      )}
      role="status"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <BarChart3 className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-foreground">{message}</p>
      {hint && <p className="max-w-[240px] text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Wraps a chart with an accessible text summary of its key insight. */
function ChartFrame({
  summary,
  className,
  children,
}: {
  summary: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="img" aria-label={summary} className={className}>
      {children}
    </div>
  );
}

/* ── Daily tokens (area) + cost (line), dual-axis trend ──────────────── */
export function DailyUsageChart({
  data,
  loading = false,
}: {
  data: Array<{ date: string; tokens: number; cost: number; requests: number }>;
  loading?: boolean;
}) {
  const reduce = usePrefersReducedMotion();
  if (loading) return <ChartSkeleton className="h-[280px]" />;
  if (!data?.length)
    return (
      <ChartEmpty
        className="h-[280px]"
        message="No usage data yet"
        hint="Token and cost trends appear here once requests are recorded."
      />
    );

  const totalTokens = data.reduce((s, d) => s + (d.tokens || 0), 0);
  const totalCost = data.reduce((s, d) => s + (d.cost || 0), 0);
  const config: ChartConfig = {
    tokens: { label: "Tokens", color: "var(--chart-1)" },
    cost: { label: "Cost (USD)", color: "var(--chart-3)" },
  };

  return (
    <ChartFrame
      summary={`Daily usage over ${data.length} days: ${fmtInt(totalTokens)} tokens and ${fmtCurrencyExact(totalCost)} total spend.`}
    >
      <ChartContainer config={config} className="h-[280px] w-full">
        <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="fillTokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-tokens)" stopOpacity={0.5} />
              <stop offset="95%" stopColor="var(--color-tokens)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={shortDate}
          />
          <YAxis
            yAxisId="tokens"
            tickLine={false}
            axisLine={false}
            width={44}
            className="tabular-nums"
            tickFormatter={(v) => fmtNumber(Number(v))}
          />
          <YAxis
            yAxisId="cost"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={52}
            className="tabular-nums"
            tickFormatter={(v) => fmtCurrency(Number(v))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v) => shortDate(String(v))}
                formatter={(value, name) => {
                  const isCost = name === "cost";
                  const val = isCost ? fmtCurrencyExact(Number(value)) : fmtInt(Number(value));
                  return (
                    <span className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">
                        {isCost ? "Cost" : "Tokens"}
                      </span>
                      <span className="font-mono font-medium tabular-nums">{val}</span>
                    </span>
                  );
                }}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Area
            yAxisId="tokens"
            dataKey="tokens"
            type="monotone"
            fill="url(#fillTokens)"
            stroke="var(--color-tokens)"
            strokeWidth={2}
            isAnimationActive={!reduce}
          />
          <Line
            yAxisId="cost"
            dataKey="cost"
            type="monotone"
            stroke="var(--color-cost)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={!reduce}
          />
        </AreaChart>
      </ChartContainer>
    </ChartFrame>
  );
}

/* ── Usage-by-model bar (cost) ───────────────────────────────────────── */
export function ModelCostChart({
  data,
  loading = false,
}: {
  data: Array<{ model: string; displayName?: string; cost: number; tokens: number }>;
  loading?: boolean;
}) {
  const reduce = usePrefersReducedMotion();
  if (loading) return <ChartSkeleton className="h-[280px]" />;
  if (!data?.length)
    return (
      <ChartEmpty
        className="h-[280px]"
        message="No model usage yet"
        hint="Per-model spend appears here once models are used."
      />
    );

  const rows = data.slice(0, 8).map((d) => ({
    name: d.displayName || d.model,
    cost: d.cost,
    tokens: d.tokens,
  }));
  const top = rows.reduce((a, b) => (b.cost > a.cost ? b : a), rows[0]);
  const config: ChartConfig = { cost: { label: "Cost", color: "var(--chart-1)" } };

  return (
    <ChartFrame
      summary={`Cost by model across ${rows.length} models. Highest spend: ${top.name} at ${fmtCurrencyExact(top.cost)}.`}
    >
      <ChartContainer config={config} className="h-[280px] w-full">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 56 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            className="tabular-nums"
            tickFormatter={(v) => fmtCurrency(Number(v))}
          />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            width={120}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => (
                  <span className="font-mono font-medium tabular-nums">
                    {fmtCurrencyExact(Number(value))}
                  </span>
                )}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="cost" fill="var(--color-cost)" radius={[0, 4, 4, 0]} isAnimationActive={!reduce}>
            <LabelList
              dataKey="cost"
              position="right"
              className="fill-muted-foreground tabular-nums"
              fontSize={11}
              formatter={(v) => fmtCurrency(Number(v))}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}

/* ── Generic categorical horizontal bar ──────────────────────────────── */
export function CategoryBarChart({
  data,
  valueLabel = "Count",
  loading = false,
  emptyMessage = "No data in this window",
}: {
  data: Array<{ label: string; count: number }>;
  valueLabel?: string;
  loading?: boolean;
  emptyMessage?: string;
}) {
  const reduce = usePrefersReducedMotion();
  if (loading) return <ChartSkeleton className="h-[240px]" />;
  const rows = data.slice(0, 10);
  if (rows.length === 0) return <ChartEmpty className="h-[240px]" message={emptyMessage} />;

  const config: ChartConfig = { count: { label: valueLabel, color: "var(--chart-2)" } };

  return (
    <ChartFrame
      summary={`${valueLabel} across ${rows.length} categories. Top: ${rows[0].label} (${fmtInt(rows[0].count)}).`}
    >
      <ChartContainer config={config} className="h-[240px] w-full">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 32 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            className="tabular-nums"
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={150}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => (
                  <span className="flex w-full justify-between gap-4">
                    <span className="text-muted-foreground">{valueLabel}</span>
                    <span className="font-mono font-medium tabular-nums">{fmtInt(Number(value))}</span>
                  </span>
                )}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} isAnimationActive={!reduce}>
            <LabelList
              dataKey="count"
              position="right"
              className="fill-muted-foreground tabular-nums"
              fontSize={11}
              formatter={(v) => fmtInt(Number(v))}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}

/* ── Donut for token-type breakdown (<=5 categories) ─────────────────── */
export function BreakdownDonut({
  data,
  centerLabel,
  centerValue,
  loading = false,
}: {
  data: Array<{ label: string; value: number }>;
  centerLabel?: string;
  centerValue?: string;
  loading?: boolean;
}) {
  const reduce = usePrefersReducedMotion();
  if (loading) return <ChartSkeleton className="mx-auto aspect-square h-[240px]" />;

  const rows = data.filter((d) => d.value > 0);
  if (rows.length === 0)
    return <ChartEmpty className="h-[240px]" message="No token data yet" />;

  const config: ChartConfig = Object.fromEntries(
    rows.map((r, i) => [r.label, { label: r.label, color: CHART_COLORS[i % CHART_COLORS.length] }])
  );
  const total = rows.reduce((s, r) => s + r.value, 0);
  const top = rows.reduce((a, b) => (b.value > a.value ? b : a), rows[0]);

  return (
    <ChartFrame
      summary={`Token breakdown, ${fmtInt(total)} total. Largest share: ${top.label} at ${Math.round((top.value / total) * 100)}%.`}
    >
      <ChartContainer config={config} className="mx-auto aspect-square h-[240px]">
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => (
                  <span className="flex w-full justify-between gap-4">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="font-mono font-medium tabular-nums">
                      {fmtInt(Number(value))}
                    </span>
                  </span>
                )}
              />
            }
          />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="label"
            innerRadius={58}
            outerRadius={90}
            strokeWidth={2}
            isAnimationActive={!reduce}
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
            {centerValue !== undefined && (
              <Label
                content={({ viewBox }) => {
                  if (!viewBox || !("cx" in viewBox)) return null;
                  const { cx, cy } = viewBox as { cx: number; cy: number };
                  return (
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan x={cx} y={cy} className="fill-foreground text-2xl font-bold tabular-nums">
                        {centerValue}
                      </tspan>
                      {centerLabel && (
                        <tspan x={cx} y={cy + 22} className="fill-muted-foreground text-xs">
                          {centerLabel}
                        </tspan>
                      )}
                    </text>
                  );
                }}
              />
            )}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey="label" className="flex-wrap gap-2" />} />
        </PieChart>
      </ChartContainer>
    </ChartFrame>
  );
}

/* ── Prompt-success gauge ────────────────────────────────────────────── */
export function SuccessGauge({ rate, loading = false }: { rate: number | null; loading?: boolean }) {
  const reduce = usePrefersReducedMotion();
  if (loading) return <ChartSkeleton className="mx-auto aspect-square h-[220px]" />;
  if (rate === null)
    return (
      <ChartEmpty
        className="h-[220px]"
        message="No prompts yet"
        hint="Success rate appears once prompts are evaluated."
      />
    );

  const value = rate;
  const config: ChartConfig = {
    success: { label: "Success", color: "var(--chart-1)" },
    rest: { label: "Other", color: "var(--muted)" },
  };
  const data = [
    { key: "success", value },
    { key: "rest", value: Math.max(0, 100 - value) },
  ];

  return (
    <ChartFrame summary={`Prompt success rate: ${value}%.`}>
      <ChartContainer config={config} className="mx-auto aspect-square h-[220px]">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="key"
            innerRadius={62}
            outerRadius={92}
            startAngle={90}
            endAngle={-270}
            strokeWidth={0}
            isAnimationActive={!reduce}
          >
            <Cell fill="var(--chart-1)" />
            <Cell fill="var(--muted)" />
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox)) return null;
                const { cx, cy } = viewBox as { cx: number; cy: number };
                return (
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={cx} y={cy} className="fill-foreground text-3xl font-bold tabular-nums">
                      {`${value}%`}
                    </tspan>
                    <tspan x={cx} y={cy + 24} className="fill-muted-foreground text-xs">
                      success rate
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
    </ChartFrame>
  );
}
