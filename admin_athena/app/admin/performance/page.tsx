"use client";

/**
 * Response-time analytics.
 *
 * Reads /api/admin/performance, which aggregates prompt_audit_logs.timings —
 * the per-request phase/tool breakdown the Fab app records on every turn.
 *
 * Only MEASURED turns are counted. Rows written before the timing
 * instrumentation shipped carry no `timings`, so they are excluded rather than
 * mixed in; a percentile over a half-instrumented window would be misleading.
 */

import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LatencyTrendChart,
  ToolLatencyChart,
  TimeBreakdownChart,
  fmtDuration,
  fmtNumber,
} from "@/components/admin/analytics-charts";
import { Timer, Zap, Gauge, Wrench, Database, TrendingUp } from "lucide-react";

interface PerformanceMetrics {
  measuredTurns: number;
  noData: boolean;
  windowDays: number;
  totalMs: { p50: number; p80: number; p95: number; max: number };
  ttftMs: { p50: number; p80: number; p95: number; max: number };
  under: { s10: number; s20: number; s40: number; s60: number };
  trend: Array<{ day: string; turns: number; p50: number; p95: number; ttft: number }>;
  tools: Array<{ name: string; calls: number; avgMs: number; maxMs: number; totalMs: number }>;
  breakdown: { ttftMs: number; streamMs: number; toolWaitedMs: number; blockingMs: number };
  slowest: Array<{
    promptId: string; user: string; datetime: string; route: string;
    totalMs: number; ttftMs: number; toolCalls: number; topPhase: string;
  }>;
  cache: { hitRate: number | null; readTokens: number; inputTokens: number };
}

const WINDOWS = [7, 30, 90];

export default function PerformancePage() {
  const [data, setData] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = useCallback((windowDays: number) => {
    setLoading(true);
    const token = localStorage.getItem("admin_athena_token");
    fetch(`/api/admin/performance?days=${windowDays}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then((r) => setData(r.ok && typeof r.body?.measuredTurns === "number" ? r.body : null))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const pct = (n: number) => `${n.toFixed(0)}%`;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader
        title="Performance"
        description={`Response time, tool latency and cache efficiency, measured per request (last ${days} days)`}
      />

      <div className="mb-6 flex items-center gap-2">
        {WINDOWS.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={w === days ? "default" : "outline"}
            onClick={() => setDays(w)}
          >
            {w} days
          </Button>
        ))}
        {data && !data.noData && (
          <span className="ml-2 text-sm text-muted-foreground">
            {fmtNumber(data.measuredTurns)} measured turns
          </span>
        )}
      </div>

      {/* Measurement started with the timing deploy; say so plainly rather than
          letting an admin read a thin window as a drop in traffic. */}
      {data?.noData && !loading && (
        <Card className="mb-6 border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No measured turns yet</CardTitle>
            <CardDescription>
              Response-time capture records a full breakdown on every request from the
              point it was deployed. Turns from before that carry no timing data and are
              excluded here. Figures will fill in as new conversations run.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Median response"
          value={loading ? "—" : fmtDuration(data?.totalMs.p50 ?? 0)}
          subtitle="Half of all turns finish faster"
          icon={<Timer className="h-5 w-5" />}
        />
        <KpiCard
          title="95th percentile"
          value={loading ? "—" : fmtDuration(data?.totalMs.p95 ?? 0)}
          subtitle="The slow tail users complain about"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <KpiCard
          title="Time to first token"
          value={loading ? "—" : fmtDuration(data?.ttftMs.p50 ?? 0)}
          subtitle="How long before anything appears"
          icon={<Zap className="h-5 w-5" />}
        />
        <KpiCard
          title="Cache hit rate"
          value={loading || data?.cache.hitRate == null ? "—" : pct(data.cache.hitRate)}
          subtitle="Input served from prompt cache"
          icon={<Database className="h-5 w-5" />}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ["Under 10s", data?.under.s10],
          ["Under 20s", data?.under.s20],
          ["Under 40s", data?.under.s40],
          ["Under 60s", data?.under.s60],
        ] as const).map(([label, value]) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-4">
              <span className="text-sm text-muted-foreground">{label}</span>
              <Badge variant={(value ?? 0) >= 80 ? "default" : (value ?? 0) >= 50 ? "warning" : "destructive"}>
                {loading || value == null ? "—" : pct(value)}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Response time by day</CardTitle>
            <CardDescription>
              Median vs 95th percentile. A steady median with a rising tail is a slow-tail
              problem, not a general slowdown — bars show turn volume behind the lines.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LatencyTrendChart data={data?.trend ?? []} loading={loading} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Slowest tools</CardTitle>
            <CardDescription>
              Ranked by total time contributed, not average — a fast tool called often can
              cost more than a slow one called twice.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ToolLatencyChart data={data?.tools ?? []} loading={loading} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where the time goes</CardTitle>
            <CardDescription>
              An average turn, split at the first token. Tool time happens during
              streaming, so it is shown separately rather than as a third segment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TimeBreakdownChart
              data={data?.breakdown ?? { ttftMs: 0, streamMs: 0, toolWaitedMs: 0, blockingMs: 0 }}
              loading={loading}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" /> Slowest individual turns
          </CardTitle>
          <CardDescription>
            The worst requests in this window, with the phase that dominated each one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="max-h-[480px] overflow-auto rounded-lg border"
            role="region"
            aria-label="Slowest individual turns"
            tabIndex={0}
          >
            <Table className="min-w-[880px]">
              <TableCaption className="sr-only">
                The slowest requests in the selected window, with the phase that dominated each one.
              </TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prompt</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">User</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">When</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Total</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">1st token</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Tools</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dominant phase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      Loading&hellip;
                    </TableCell>
                  </TableRow>
                ) : (data?.slowest.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No measured turns in this window.
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.slowest.map((r) => (
                    <TableRow key={r.promptId} className="hover:bg-muted/30">
                      <TableCell className="px-4 py-3 font-mono text-xs">{r.promptId}</TableCell>
                      <TableCell className="px-4 py-3 font-medium">{r.user}</TableCell>
                      <TableCell className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {r.datetime}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <Badge variant="secondary">{r.route}</Badge>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                        {fmtDuration(r.totalMs)}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {fmtDuration(r.ttftMs)}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {r.toolCalls}
                      </TableCell>
                      <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {r.topPhase}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Gauge className="h-3.5 w-3.5" />
        Tools inside one step run concurrently, so &ldquo;waiting on tools&rdquo; is the sum of each
        step&rsquo;s slowest call, not the sum of every call. Provider-run tools (code execution,
        web search) execute outside our process and carry no individual duration.
      </p>
    </div>
  );
}
