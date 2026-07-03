"use client";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DailyUsageChart,
  ModelCostChart,
  BreakdownDonut,
  fmtNumber,
  fmtCurrency,
} from "@/components/admin/analytics-charts";
import { Zap, MessageSquare, Cpu, DollarSign, Timer } from "lucide-react";

interface ModelRow {
  model: string;
  displayName: string;
  requests: number;
  tokens: number;
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheCreation: number;
  cost: number;
}

interface UserRow {
  userId: string;
  name: string | null;
  email: string;
  requests: number;
  tokens: number;
  cost: number;
}

interface UsageData {
  days: number;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  avgRequestDurationMs: number;
  tokenBreakdown: {
    input: number;
    output: number;
    thinking: number;
    cacheRead: number;
    cacheCreation: number;
    total: number;
  };
  byModel: ModelRow[];
  topUsersByCost: UserRow[];
  topUsersByTokens: UserRow[];
  timeSeries: Array<{ date: string; tokens: number; cost: number; requests: number }>;
}

function fmtDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms).toLocaleString()}ms`;
  return `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}s`;
}

const DAY_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("30");

  const load = useCallback(async () => {
    const token = localStorage.getItem("admin_athena_token");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/usage?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      // Only accept a well-formed analytics payload; an error envelope
      // (e.g. before the model_registry migration) leaves data null.
      setData(res.ok && json && json.tokenBreakdown ? json : null);
    } catch {
      console.error("Failed to load usage data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const breakdown = data
    ? [
        { label: "Input", value: data.tokenBreakdown.input },
        { label: "Output", value: data.tokenBreakdown.output },
        { label: "Thinking", value: data.tokenBreakdown.thinking },
        { label: "Cache read", value: data.tokenBreakdown.cacheRead },
        { label: "Cache write", value: data.tokenBreakdown.cacheCreation },
      ]
    : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader title="Usage & Cost" description="Token consumption, spend and per-user analytics">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[160px]" aria-label="Time range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AdminPageHeader>

      {loading ? (
        <div className="mt-8 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg border bg-muted motion-reduce:animate-none" />
            ))}
          </div>
          <div className="h-80 animate-pulse rounded-lg border bg-muted motion-reduce:animate-none" />
        </div>
      ) : data ? (
        <div className="mt-8 space-y-6">
          {/* ── KPIs ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard title="Total Cost" value={fmtCurrency(data.totalCost)} subtitle={`over ${data.days} days`} icon={<DollarSign className="h-5 w-5" />} />
            <KpiCard title="Total Requests" value={fmtNumber(data.totalRequests)} subtitle={`${fmtNumber(data.totalTokens)} tokens`} icon={<MessageSquare className="h-5 w-5" />} />
            <KpiCard title="Total Tokens" value={fmtNumber(data.totalTokens)} subtitle="input + output + cache" icon={<Zap className="h-5 w-5" />} />
            <KpiCard title="Models Used" value={data.byModel?.length || 0} subtitle="with recorded usage" icon={<Cpu className="h-5 w-5" />} />
            <KpiCard
              title="Avg Duration"
              value={fmtDurationMs(data.avgRequestDurationMs)}
              subtitle="per request"
              icon={<Timer className="h-5 w-5" />}
            />
          </div>

          {/* ── Trend + token breakdown ── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">Daily Tokens & Cost</CardTitle>
                <CardDescription>Consumption over the selected window</CardDescription>
              </CardHeader>
              <CardContent>
                <DailyUsageChart data={data.timeSeries ?? []} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Token Breakdown</CardTitle>
                <CardDescription>By token type</CardDescription>
              </CardHeader>
              <CardContent>
                <BreakdownDonut
                  data={breakdown}
                  centerLabel="tokens"
                  centerValue={fmtNumber(data.tokenBreakdown.total)}
                />
              </CardContent>
            </Card>
          </div>

          {/* ── Cost by model chart ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cost by Model</CardTitle>
              <CardDescription>Estimated USD spend per model</CardDescription>
            </CardHeader>
            <CardContent>
              <ModelCostChart data={data.byModel ?? []} />
            </CardContent>
          </Card>

          {/* ── Per-model table ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Usage by Model</CardTitle>
              <CardDescription>Requests, tokens and cost per model</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[480px] overflow-auto rounded-lg border" role="region" aria-label="Usage by model" tabIndex={0}>
                <Table className="min-w-[720px]">
                  <TableCaption className="sr-only">Token usage and cost broken down by model.</TableCaption>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Model</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Requests</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Input</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cache</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tokens</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byModel.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No usage data yet.</TableCell></TableRow>
                    ) : (
                      data.byModel.map((m) => (
                        <TableRow key={m.model} className="hover:bg-muted/30">
                          <TableCell className="px-4 py-3 font-medium">{m.displayName}</TableCell>
                          <TableCell className="px-4 py-3 text-right tabular-nums">{fmtNumber(m.requests)}</TableCell>
                          <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtNumber(m.input)}</TableCell>
                          <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtNumber(m.output + m.thinking)}</TableCell>
                          <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtNumber(m.cacheRead + m.cacheCreation)}</TableCell>
                          <TableCell className="px-4 py-3 text-right tabular-nums">{fmtNumber(m.tokens)}</TableCell>
                          <TableCell className="px-4 py-3 text-right font-medium tabular-nums">{fmtCurrency(m.cost)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ── Top users ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top Users by Cost</CardTitle>
                <CardDescription>Highest spend in the window</CardDescription>
              </CardHeader>
              <CardContent>
                <TopUsersTable rows={data.topUsersByCost} metric="cost" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top Users by Tokens</CardTitle>
                <CardDescription>Highest consumption in the window</CardDescription>
              </CardHeader>
              <CardContent>
                <TopUsersTable rows={data.topUsersByTokens} metric="tokens" />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center gap-1.5 py-16 text-center">
            <p className="text-sm font-medium text-foreground">Couldn&apos;t load usage data</p>
            <p className="text-sm text-muted-foreground">
              Try a different time range or refresh the page.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TopUsersTable({ rows, metric }: { rows: UserRow[]; metric: "cost" | "tokens" }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border" role="region" aria-label="Top users" tabIndex={0}>
      <Table className="min-w-[420px]">
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">User</TableHead>
            <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Requests</TableHead>
            <TableHead className="sticky top-0 z-10 bg-muted px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {metric === "cost" ? "Cost" : "Tokens"}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No usage data yet.</TableCell></TableRow>
          ) : (
            rows.map((u) => (
              <TableRow key={u.userId} className="hover:bg-muted/30">
                <TableCell className="px-4 py-3">
                  <div className="font-medium">{u.name || u.email}</div>
                  {u.name && <div className="text-xs text-muted-foreground">{u.email}</div>}
                </TableCell>
                <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtNumber(u.requests)}</TableCell>
                <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                  {metric === "cost" ? fmtCurrency(u.cost) : fmtNumber(u.tokens)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
