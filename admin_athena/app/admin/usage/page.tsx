"use client";

import { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, MessageSquare, Cpu } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UsageData = any;

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("admin_athena_token");
    fetch("/api/admin/usage?days=30", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader title="Usage" description="Token consumption and request volume (last 30 days)" />

      {loading ? (
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 animate-pulse rounded-lg border bg-muted" />)}
        </div>
      ) : data ? (
        <>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <KpiCard title="Total Requests" value={fmt(data.totalRequests)} icon={<MessageSquare className="h-5 w-5" />} />
            <KpiCard title="Total Tokens" value={fmt(data.totalTokens)} icon={<Zap className="h-5 w-5" />} />
            <KpiCard title="Models Used" value={data.perModel?.length || 0} icon={<Cpu className="h-5 w-5" />} />
          </div>

          {/* Per-model breakdown */}
          <Card className="mt-6">
            <CardHeader><CardTitle className="text-lg">Usage by Model</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.perModel?.map((m: { model: string; requests: number; tokens: number }) => (
                  <div key={m.model} className="flex flex-col gap-1 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                    <span className="text-sm font-medium break-all">{m.model}</span>
                    <div className="flex gap-6 text-sm text-muted-foreground">
                      <span>{fmt(m.requests)} requests</span>
                      <span>{fmt(m.tokens)} tokens</span>
                    </div>
                  </div>
                ))}
                {(!data.perModel || data.perModel.length === 0) && (
                  <p className="text-sm text-muted-foreground">No usage data yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="mt-8 text-muted-foreground">Failed to load usage data.</p>
      )}
    </div>
  );
}
