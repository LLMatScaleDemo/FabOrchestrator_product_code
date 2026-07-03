"use client";

import { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DailyUsageChart,
  ModelCostChart,
  CategoryBarChart,
  SuccessGauge,
  fmtNumber,
  fmtCurrency,
} from "@/components/admin/analytics-charts";
import {
  Users,
  MessageSquare,
  Zap,
  DollarSign,
  Activity,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

interface DashboardData {
  totalUsers: number;
  activeUsers: number;
  totalConversations: number;
  totalRoles: number;
  totalRequests30d: number;
  totalTokens30d: number;
  users: { total: number; active: number; suspended: number; admins: number };
  conversations: { total: number; last7d: number; last30d: number };
  messages: { total: number };
  mcp: { total: number; connected: number };
  sessions: { active: number; closedIdle7d: number; avgDurationSec: number };
  usage: {
    last7d: { requests: number; tokens: { total: number } };
    last30d: { requests: number; tokens: { total: number } };
  };
  cost: { last7d: number; last30d: number; source: string };
  errors: {
    open: number;
    total30d: number;
    byPriority: Array<{ priority: string; count: number }>;
    byType: Array<{ type: string; count: number }>;
  };
  prompts: {
    total: number;
    successRate: number | null;
    avgResponseMs: number;
    byTopic: Array<{ topic: string; count: number }>;
  };
}

interface UsageData {
  totalCost: number;
  byModel: Array<{ model: string; displayName: string; cost: number; tokens: number }>;
  timeSeries: Array<{ date: string; tokens: number; cost: number; requests: number }>;
}

function fmtDuration(sec: number): string {
  if (!sec) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("admin_athena_token");
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch("/api/admin/dashboard", { headers }).then(async (r) => ({ ok: r.ok, body: await r.json() })),
      fetch("/api/admin/usage?days=30", { headers }).then(async (r) => ({ ok: r.ok, body: await r.json() })),
    ])
      .then(([d, u]) => {
        // Ignore error envelopes so a partial/failed response never breaks the UI.
        setData(d.ok && d.body?.users ? d.body : null);
        setUsage(u.ok && u.body?.tokenBreakdown ? u.body : null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const priorityVariant = (p: string): "destructive" | "warning" | "secondary" => {
    if (p === "HIGH") return "destructive";
    if (p === "MEDIUM") return "warning";
    return "secondary";
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader
        title="Dashboard"
        description="Enterprise overview of platform activity, usage, cost and reliability (last 30 days)"
      />

      {loading ? (
        <div className="mt-8 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg border bg-muted motion-reduce:animate-none" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-80 animate-pulse rounded-lg border bg-muted motion-reduce:animate-none" />
            ))}
          </div>
        </div>
      ) : data ? (
        <div className="mt-8 space-y-6">
          {/* ── Stat tiles ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Users"
              value={fmtNumber(data.users?.total ?? data.totalUsers)}
              subtitle={`${data.users?.active ?? data.activeUsers} active · ${data.users?.suspended ?? 0} suspended`}
              icon={<Users className="h-5 w-5" />}
            />
            <KpiCard
              title="Active Sessions"
              value={fmtNumber(data.sessions?.active ?? 0)}
              subtitle={`avg ${fmtDuration(data.sessions?.avgDurationSec ?? 0)} · ${data.sessions?.closedIdle7d ?? 0} idle-out (7d)`}
              icon={<Activity className="h-5 w-5" />}
            />
            <KpiCard
              title="Requests (30d)"
              value={fmtNumber(data.usage?.last30d?.requests ?? data.totalRequests30d)}
              subtitle={`${fmtNumber(data.usage?.last7d?.requests ?? 0)} in last 7 days`}
              icon={<MessageSquare className="h-5 w-5" />}
            />
            <KpiCard
              title="Total Cost (30d)"
              value={fmtCurrency(data.cost?.last30d ?? 0)}
              subtitle={`${fmtCurrency(data.cost?.last7d ?? 0)} last 7d · via ${data.cost?.source ?? "usage"}`}
              icon={<DollarSign className="h-5 w-5" />}
            />
            <KpiCard
              title="Tokens (30d)"
              value={fmtNumber(data.usage?.last30d?.tokens?.total ?? data.totalTokens30d)}
              subtitle="input + output + thinking + cache"
              icon={<Zap className="h-5 w-5" />}
            />
            <KpiCard
              title="Conversations"
              value={fmtNumber(data.conversations?.total ?? data.totalConversations)}
              subtitle={`${data.conversations?.last7d ?? 0} new this week`}
              icon={<MessageSquare className="h-5 w-5" />}
            />
            <KpiCard
              title="Open Errors"
              value={fmtNumber(data.errors?.open ?? 0)}
              subtitle={`${data.errors?.total30d ?? 0} logged in 30d`}
              icon={<AlertTriangle className="h-5 w-5" />}
            />
            <KpiCard
              title="Prompt Success"
              value={data.prompts?.successRate === null || data.prompts?.successRate === undefined ? "—" : `${data.prompts.successRate}%`}
              subtitle={`${fmtNumber(data.prompts?.total ?? 0)} prompts · ${Math.round((data.prompts?.avgResponseMs ?? 0))}ms avg`}
              icon={<CheckCircle2 className="h-5 w-5" />}
            />
          </div>

          {/* ── Trend + model cost ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Daily Token Usage</CardTitle>
                <CardDescription>Total tokens consumed per day (last 30 days)</CardDescription>
              </CardHeader>
              <CardContent>
                <DailyUsageChart data={usage?.timeSeries ?? []} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Cost by Model</CardTitle>
                <CardDescription>Estimated USD spend per model (30d)</CardDescription>
              </CardHeader>
              <CardContent>
                <ModelCostChart data={usage?.byModel ?? []} />
              </CardContent>
            </Card>
          </div>

          {/* ── Reliability + prompts ── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Errors by Type</CardTitle>
                <CardDescription>Last 30 days</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryBarChart
                  data={(data.errors?.byType ?? []).map((e) => ({ label: e.type, count: e.count }))}
                  valueLabel="Errors"
                  emptyMessage="No errors logged"
                />
                {(data.errors?.byPriority?.length ?? 0) > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {data.errors.byPriority.map((p) => (
                      <Badge key={p.priority} variant={priorityVariant(p.priority)}>
                        {p.priority}: {p.count}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Prompts by Topic</CardTitle>
                <CardDescription>Distribution across use cases (30d)</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryBarChart
                  data={(data.prompts?.byTopic ?? []).map((t) => ({ label: t.topic, count: t.count }))}
                  valueLabel="Prompts"
                  emptyMessage="No prompts yet"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Prompt Success</CardTitle>
                <CardDescription>Share of successful prompts (30d)</CardDescription>
              </CardHeader>
              <CardContent>
                <SuccessGauge rate={data.prompts?.successRate ?? null} />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center gap-1.5 py-16 text-center">
            <p className="text-sm font-medium text-foreground">Couldn&apos;t load dashboard data</p>
            <p className="text-sm text-muted-foreground">Check your connection and refresh the page.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
