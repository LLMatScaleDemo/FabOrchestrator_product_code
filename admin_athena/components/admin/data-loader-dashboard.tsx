"use client";

import { useEffect, useState } from "react";
import { Package, PlayCircle, CheckCircle2, XCircle } from "lucide-react";

type Recent = {
  id: string;
  packageName: string;
  operation: string;
  status: string;
  result: number | null;
  user: string;
  startedAt: string;
};

type LoaderStats = {
  totalPackages: number;
  totalRuns: number;
  success: number;
  failure: number;
  inFlight: number;
  successRate: number | null;
  recent: Recent[];
  degraded?: boolean;
};

function StatusPill({ status, result }: { status: string; result: number | null }) {
  let text = status;
  let tone = "bg-primary/10 text-primary";
  if (result === 0) {
    text = "Success";
    tone = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  } else if (result === 1) {
    text = "Failure";
    tone = "bg-destructive/15 text-destructive";
  } else if (status === "FAILURE") {
    text = "Errored";
    tone = "bg-amber-500/15 text-amber-600";
  } else if (status === "EXPIRED") {
    text = "Expired";
    tone = "bg-amber-500/15 text-amber-600";
  } else {
    text = status === "QUEUED" || status === "RUNNING" ? "Running" : status;
  }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{text}</span>;
}

function Card({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function DataLoaderDashboard() {
  const [stats, setStats] = useState<LoaderStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("admin_athena_token");
    fetch("/api/admin/cmf-loads", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border bg-muted motion-reduce:animate-none" />
        ))}
      </div>
    );
  }
  if (!stats) return <p className="mt-6 text-sm text-muted-foreground">Couldn&apos;t load Data Loader metrics.</p>;

  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card icon={<Package className="h-5 w-5" />} label="Packages" value={stats.totalPackages} />
        <Card icon={<PlayCircle className="h-5 w-5" />} label="Total loads" value={stats.totalRuns} />
        <Card
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          label="Success rate"
          value={stats.successRate == null ? "—" : `${stats.successRate}%`}
          sub={`${stats.success} succeeded`}
        />
        <Card
          icon={<XCircle className="h-5 w-5 text-destructive" />}
          label="Failures"
          value={stats.failure}
          sub={stats.inFlight > 0 ? `${stats.inFlight} in flight` : undefined}
        />
      </div>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Recent loads</h2>
        </div>
        {stats.recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No master-data loads yet. Runs from the Modeling Agent appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Package</th>
                  <th className="px-4 py-2 text-left font-medium">Operation</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">By</th>
                  <th className="px-4 py-2 text-left font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium">{r.packageName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.operation === "LOAD" ? "Load" : "Validate"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={r.status} result={r.result} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.user}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {r.startedAt.slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
