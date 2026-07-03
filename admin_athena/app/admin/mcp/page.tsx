"use client";

import { useEffect, useState, useCallback } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Plus, Wrench, Trash2, Loader2, Globe, Pencil, AlertTriangle } from "lucide-react";

interface Connector {
  id: string;
  displayName: string;
  description: string | null;
  serverUrl: string;
  authType: string;
  hasCredentials: boolean;
  isActive: boolean;
  assignmentCount: number;
}

const AUTH_LABELS: Record<string, string> = { none: "None", api_key: "API Key", oauth: "OAuth" };

export default function McpPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Connector | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();

  const token = typeof window !== "undefined" ? localStorage.getItem("admin_athena_token") : null;

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/mcp-registry", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setConnectors(data.servers || []);
    } catch {
      toast.error("Failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleActive = async (c: Connector) => {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/admin/mcp-registry/${c.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !c.isActive }),
      });
      if (!res.ok) { toast.error("Failed to update"); return; }
      setConnectors((prev) => prev.map((x) => (x.id === c.id ? { ...x, isActive: !x.isActive } : x)));
    } catch { toast.error("Failed to update"); } finally { setBusyId(null); }
  };

  const handleDelete = async (c: Connector) => {
    const description = c.assignmentCount > 0
      ? `This also removes it from ${c.assignmentCount} role/user assignment(s).`
      : "This permanently removes the connector from the catalog.";
    const ok = await confirm({
      title: `Delete "${c.displayName}"?`,
      description,
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/admin/mcp-registry/${c.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { toast.error("Failed to delete"); return; }
      toast.success(`"${c.displayName}" deleted`);
      fetchData();
    } catch { toast.error("Failed to delete"); } finally { setBusyId(null); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader title="MCP Connections" description="Manage the catalog of MCP server connectors. Assign them to users and roles from their sections.">
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="bg-primary">
          <Plus className="mr-2 h-4 w-4" /> Add Custom Connector
        </Button>
      </AdminPageHeader>

      {loading ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-40 animate-pulse rounded-lg border bg-muted" />)}
        </div>
      ) : connectors.length === 0 ? (
        <div className="mt-12 text-center">
          <Wrench className="mx-auto h-12 w-12 text-muted-foreground/30" />
          <h3 className="mt-4 text-lg font-medium">No MCP connectors yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">Add a custom connector, then assign it to users or roles.</p>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="mt-4">
            <Plus className="mr-2 h-4 w-4" /> Add Custom Connector
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connectors.map((c) => (
            <Card key={c.id} className="flex flex-col transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Wrench className="h-4 w-4 shrink-0 text-primary" />
                    <CardTitle className="truncate text-base">{c.displayName}</CardTitle>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(c); setDialogOpen(true); }} title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" disabled={busyId === c.id} onClick={() => handleDelete(c)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col space-y-2">
                {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Globe className="h-3 w-3 shrink-0" />
                  <span className="truncate">{c.serverUrl}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs">{AUTH_LABELS[c.authType] || c.authType}</Badge>
                  <Badge variant="secondary" className="text-xs">{c.assignmentCount} assigned</Badge>
                </div>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => toggleActive(c)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      c.isActive ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${c.isActive ? "bg-green-500" : "bg-muted-foreground"}`} />
                    {c.isActive ? "Active" : "Inactive"}
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConnectorDialog
        open={dialogOpen}
        editing={editing}
        token={token}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { setDialogOpen(false); fetchData(); }}
      />
    </div>
  );
}

// ── Add / Edit Custom Connector ──
function ConnectorDialog({ open, editing, token, onClose, onSaved }: {
  open: boolean;
  editing: Connector | null;
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [authType, setAuthType] = useState<"none" | "api_key" | "oauth">("none");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.displayName || "");
      setUrl(editing?.serverUrl || "");
      setDescription(editing?.description || "");
      setAuthType((editing?.authType as "none" | "api_key" | "oauth") || "none");
      setApiKey("");
    }
  }, [open, editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) { toast.error("Name and server URL are required"); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { displayName: name.trim(), serverUrl: url.trim(), authType, description: description.trim() };
      if (authType === "api_key" && apiKey) body.apiKey = apiKey;
      const res = await fetch(editing ? `/api/admin/mcp-registry/${editing.id}` : "/api/admin/mcp-registry", {
        method: editing ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || "Failed"); setSubmitting(false); return; }
      toast.success(editing ? "Connector updated" : "Connector added");
      onSaved();
    } catch { toast.error("Failed to save connector"); } finally { setSubmitting(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit Connector" : "Add Custom Connector"}</SheetTitle>
          <SheetDescription>Connect to a remote MCP server to extend Claude&apos;s capabilities with custom tools.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My MCP Server" required />
          </div>
          <div className="space-y-2">
            <Label>Remote MCP Server URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/api" required />
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this connector provides" />
          </div>
          <div className="space-y-2">
            <Label>Authentication Type</Label>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(["none", "api_key", "oauth"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAuthType(t)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    authType === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {AUTH_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          {authType === "api_key" && (
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={editing?.hasCredentials ? "Leave blank to keep existing key" : "Enter API key"} />
            </div>
          )}

          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <span className="font-semibold">Security Notice</span><br />
              Only connect to MCP servers from developers you trust. Connected servers can execute tools and access data on your behalf.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting} className="bg-primary">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save Changes" : "Add Connector"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
