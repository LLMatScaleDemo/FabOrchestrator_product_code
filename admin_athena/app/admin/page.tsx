"use client";

import { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { Users, MessageSquare, Shield, Zap } from "lucide-react";

interface DashboardData {
  totalUsers: number;
  activeUsers: number;
  totalConversations: number;
  totalRoles: number;
  totalRequests30d: number;
  totalTokens30d: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("admin_athena_token");
    fetch("/api/admin/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader
        title="Dashboard"
        description="Overview of your AI platform"
      />

      {loading ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg border bg-muted" />
          ))}
        </div>
      ) : data ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Total Users"
            value={data.totalUsers}
            subtitle={`${data.activeUsers} active in last 30 days`}
            icon={<Users className="h-5 w-5" />}
          />
          <KpiCard
            title="Conversations"
            value={formatNumber(data.totalConversations)}
            subtitle="Total conversations"
            icon={<MessageSquare className="h-5 w-5" />}
          />
          <KpiCard
            title="Roles"
            value={data.totalRoles}
            subtitle="Active role definitions"
            icon={<Shield className="h-5 w-5" />}
          />
          <KpiCard
            title="Tokens (30d)"
            value={formatNumber(data.totalTokens30d)}
            subtitle={`${formatNumber(data.totalRequests30d)} requests`}
            icon={<Zap className="h-5 w-5" />}
          />
        </div>
      ) : (
        <p className="mt-8 text-muted-foreground">Failed to load dashboard data.</p>
      )}
    </div>
  );
}
