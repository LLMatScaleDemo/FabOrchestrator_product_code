"use client";

import { useEffect, useState, useCallback } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserDetailPanel } from "@/components/admin/user-detail-panel";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { Plus, Search } from "lucide-react";
import { toast } from "@/components/ui/toast";

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

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const token = typeof window !== "undefined" ? localStorage.getItem("admin_athena_token") : null;

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ meta: "true" });
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setUsers(data.users || []);
      if (data.meta?.roles) setRoles(data.meta.roles);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [token, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAction = async (userId: string, action: string, extra?: Record<string, string>) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Action failed");
        return;
      }
      toast.success(`User ${action} successful`);
      fetchUsers();
      setSelectedUser(null);
    } catch {
      toast.error("Action failed");
    }
  };

  const handleDelete = async (userId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success("User deleted");
      fetchUsers();
      setSelectedUser(null);
    } catch {
      toast.error("Delete failed");
    }
  };

  const handleForceReset = async (userId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}/force-reset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { toast.error("Failed"); return; }
      toast.success("Password reset forced");
      fetchUsers();
    } catch { toast.error("Failed"); }
  };

  const handleForceLogout = async (userId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}/force-logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { toast.error("Failed"); return; }
      toast.success("All sessions terminated");
      fetchUsers();
    } catch { toast.error("Failed"); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader title="Users" description="Manage user accounts and access">
        <Button onClick={() => setShowCreate(true)} className="bg-primary">
          <Plus className="mr-2 h-4 w-4" /> Invite User
        </Button>
      </AdminPageHeader>

      {/* Search */}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative w-full sm:max-w-sm sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="user-search" className="sr-only">Search users by name or email</label>
          <Input
            id="user-search"
            type="search"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">{users.length} users</p>
      </div>

      {/* Table */}
      <div
        className="mt-6 overflow-x-auto rounded-lg border"
        role="region"
        aria-label="Users"
        tabIndex={0}
      >
        <table className="w-full min-w-[640px]">
          <caption className="sr-only">List of user accounts with role, status, and last active date. Select a row to view details.</caption>
          <thead>
            <tr className="border-b bg-muted/50">
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">User</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Role</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b">
                  <td colSpan={4} className="px-4 py-4"><div className="h-4 w-48 animate-pulse rounded bg-muted" /></td>
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No users found</td></tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => setSelectedUser(user)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedUser(user);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`View details for ${user.name || user.email}`}
                  className="cursor-pointer border-b transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{user.name || "—"}</p>
                      <p className="text-sm text-muted-foreground">{user.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {user.role ? (
                        <Badge variant="secondary">{user.role.name}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">No role</span>
                      )}
                      {user.isAdmin && <Badge variant="default">Admin</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={user.status === "ACTIVE" ? "success" : "destructive"}>
                      {user.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : "Never"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Panel */}
      <UserDetailPanel
        user={selectedUser}
        roles={roles}
        open={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        onAction={handleAction}
        onDelete={handleDelete}
        onForceReset={handleForceReset}
        onForceLogout={handleForceLogout}
      />

      {/* Create Dialog */}
      <CreateUserDialog
        roles={roles}
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); fetchUsers(); }}
      />
    </div>
  );
}
