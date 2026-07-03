"use client";

import { useEffect, useState, useCallback } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { Download } from "lucide-react";

interface AuditLogEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; email: string; name: string | null } | null;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const token = typeof window !== "undefined" ? localStorage.getItem("admin_athena_token") : null;

  const fetchLogs = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/audit-logs?page=${page}&pageSize=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setLogs(data.logs || []);
      setTotalPages(data.totalPages || 1);
    } catch {
      console.error("Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [token, page]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleExport = async (format: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/audit-logs/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { toast.error("Export failed"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Export failed"); }
  };

  const actionColor = (action: string): "default" | "destructive" | "success" | "warning" | "secondary" => {
    if (action.includes("deleted") || action.includes("suspended")) return "destructive";
    if (action.includes("created") || action.includes("activated")) return "success";
    if (action.includes("force")) return "warning";
    return "secondary";
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader title="Audit Logs" description="Track all admin actions">
        <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </AdminPageHeader>

      <div
        className="mt-6 overflow-x-auto rounded-lg border"
        role="region"
        aria-label="Audit logs"
        tabIndex={0}
      >
        <table className="w-full min-w-[720px]">
          <caption className="sr-only">Chronological log of administrative actions.</caption>
          <thead>
            <tr className="border-b bg-muted/50">
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Action</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Admin</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Target</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b"><td colSpan={5} className="px-4 py-4"><div className="h-4 w-64 animate-pulse rounded bg-muted" /></td></tr>
              ))
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No audit logs yet</td></tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={actionColor(log.action)}>{log.action}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {log.user?.email || "system"}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {log.targetType && `${log.targetType}`}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                    {log.metadata && Object.keys(log.metadata).length > 0
                      ? Object.entries(log.metadata).map(([k, v]) => `${k}: ${v}`).join(", ")
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Audit log pagination">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">Previous</Button>
          <span className="text-sm text-muted-foreground" aria-current="page">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">Next</Button>
        </nav>
      )}
    </div>
  );
}
