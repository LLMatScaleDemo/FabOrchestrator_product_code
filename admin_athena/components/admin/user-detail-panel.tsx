"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Shield, Ban, CheckCircle, Key, LogOut, Trash2, UserCog, Wrench, Plus, X, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface AssignedMcp { id: string; name: string; serverUrl: string; authType: string; registryId: string | null }
interface CatalogConnector { id: string; displayName: string; isActive: boolean }

function UserMcpSection({ userId }: { userId: string }) {
  const token = typeof window !== "undefined" ? localStorage.getItem("admin_athena_token") : null;
  const [assigned, setAssigned] = useState<AssignedMcp[]>([]);
  const [catalog, setCatalog] = useState<CatalogConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [aRes, cRes] = await Promise.all([
        fetch(`/api/admin/mcp?userId=${userId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/admin/mcp-registry`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const a = await aRes.json(); const c = await cRes.json();
      setAssigned(a.connections || []);
      setCatalog((c.servers || []).filter((s: CatalogConnector) => s.isActive));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [token, userId]);

  useEffect(() => { load(); }, [load]);

  const assign = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ registryId: pick, userId }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || "Failed to assign"); return; }
      toast.success("MCP assigned");
      setPick("");
      load();
    } catch { toast.error("Failed to assign"); } finally { setBusy(false); }
  };

  const remove = async (connId: string, name: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/mcp/${connId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { toast.error("Failed to remove"); return; }
      toast.success(`"${name}" removed`);
      load();
    } catch { toast.error("Failed to remove"); } finally { setBusy(false); }
  };

  const available = catalog.filter((c) => !assigned.some((a) => a.name === c.displayName));

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">MCP Access</p>
      {loading ? (
        <div className="h-8 animate-pulse rounded-md bg-muted" />
      ) : (
        <>
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">No MCP connectors assigned.</p>
          ) : (
            <div className="space-y-1.5">
              {assigned.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
                  <Wrench className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  {!m.registryId && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground" title="Added by the user in chat settings">
                      Personal
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy} onClick={() => remove(m.id, m.name)} title="Remove" aria-label={`Remove ${m.name}`}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Select value={pick} onValueChange={setPick} disabled={available.length === 0}>
              <SelectTrigger aria-label="Assign MCP connector to user" className="h-9 w-full flex-1">
                <SelectValue placeholder={available.length ? "Assign a connector..." : "All active connectors assigned"} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {available.map((c) => <SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button size="sm" disabled={!pick || busy} onClick={assign} aria-label="Assign connector">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  status: string;
  isAdmin: boolean;
  role: { id: string; name: string } | null;
  createdAt: string;
  lastLogin: string | null;
  forcePasswordChange: boolean;
}

interface RoleMeta {
  id: string;
  name: string;
}

interface UserDetailPanelProps {
  user: UserRow | null;
  roles: RoleMeta[];
  open: boolean;
  onClose: () => void;
  onAction: (userId: string, action: string, extra?: Record<string, string>) => void;
  onDelete: (userId: string) => void;
  onForceReset: (userId: string) => void;
  onForceLogout: (userId: string) => void;
}

export function UserDetailPanel({
  user,
  roles,
  open,
  onClose,
  onAction,
  onDelete,
  onForceReset,
  onForceLogout,
}: UserDetailPanelProps) {
  const confirm = useConfirm();

  if (!user) return null;

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete User?",
      description: `Delete ${user.email}? This cannot be undone.`,
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    onDelete(user.id);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{user.name || user.email}</SheetTitle>
          <SheetDescription>{user.email}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status & Role */}
          <div className="flex items-center gap-2">
            <Badge variant={user.status === "ACTIVE" ? "success" : "destructive"}>
              {user.status}
            </Badge>
            {user.role && <Badge variant="secondary">{user.role.name}</Badge>}
            {user.isAdmin && <Badge variant="default">Admin</Badge>}
            {user.forcePasswordChange && <Badge variant="warning">Must Change Password</Badge>}
          </div>

          {/* Info */}
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Created</span>
              <span>{new Date(user.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Last Login</span>
              <span>{user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : "Never"}</span>
            </div>
          </div>

          <Separator />

          {/* MCP Access */}
          <UserMcpSection userId={user.id} />

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</p>

            {/* Status Toggle */}
            {user.status === "ACTIVE" ? (
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => onAction(user.id, "suspend")}
              >
                <Ban className="mr-2 h-4 w-4 text-red-500" aria-hidden="true" />
                Suspend User
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => onAction(user.id, "activate")}
              >
                <CheckCircle className="mr-2 h-4 w-4 text-green-500" aria-hidden="true" />
                Activate User
              </Button>
            )}

            {/* Change Role */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <UserCog className="mr-2 h-4 w-4" aria-hidden="true" />
                  Change Role
                  <span className="ml-auto text-xs text-muted-foreground">
                    {user.role?.name || "None"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {roles.map((role) => (
                  <DropdownMenuItem
                    key={role.id}
                    onClick={() => onAction(user.id, "changeRole", { roleId: role.id })}
                    disabled={user.role?.id === role.id}
                  >
                    {role.name}
                    {user.role?.id === role.id && " (current)"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Toggle Admin */}
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => onAction(user.id, "toggleAdmin")}
            >
              <Shield className="mr-2 h-4 w-4" aria-hidden="true" />
              {user.isAdmin ? "Remove Admin Access" : "Grant Admin Access"}
            </Button>

            <Separator />

            {/* Security Actions */}
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => onForceReset(user.id)}
            >
              <Key className="mr-2 h-4 w-4 text-orange-500" aria-hidden="true" />
              Force Password Reset
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => onForceLogout(user.id)}
            >
              <LogOut className="mr-2 h-4 w-4 text-orange-500" aria-hidden="true" />
              Force Logout (All Sessions)
            </Button>

            <Separator />

            {/* Danger zone */}
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-destructive">Danger Zone</p>
              <p className="mt-1 text-xs text-muted-foreground">Permanently deletes this account and all its data. This cannot be undone.</p>
              <Button
                variant="destructive"
                className="mt-3 w-full cursor-pointer justify-start"
                onClick={handleDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Delete User
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
