"use client";

import { useEffect, useState, useCallback } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RoleCard } from "@/components/admin/role-card";
import { RoleFormModal } from "@/components/admin/role-form-modal";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Plus } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RoleData = any;

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editRole, setEditRole] = useState<RoleData | null>(null);
  const confirm = useConfirm();

  const token = typeof window !== "undefined" ? localStorage.getItem("admin_athena_token") : null;

  const fetchRoles = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/roles", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setRoles(data.roles || []);
    } catch {
      toast.error("Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  const handleDelete = async (roleId: string) => {
    if (!token) return;
    const ok = await confirm({
      title: "Delete this role?",
      description: "This permanently removes the role. Users assigned to it will lose its permissions.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/roles/${roleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to delete role");
        return;
      }
      toast.success("Role deleted");
      fetchRoles();
    } catch {
      toast.error("Failed to delete role");
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader title="Roles" description="Define access levels, model permissions, and usage limits">
        <Button onClick={() => { setEditRole(null); setShowForm(true); }} className="bg-primary">
          <Plus className="mr-2 h-4 w-4" /> Create Role
        </Button>
      </AdminPageHeader>

      {loading ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg border bg-muted" />
          ))}
        </div>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              onEdit={() => { setEditRole(role); setShowForm(true); }}
              onDelete={() => handleDelete(role.id)}
            />
          ))}
        </div>
      )}

      <RoleFormModal
        open={showForm}
        onClose={() => { setShowForm(false); setEditRole(null); }}
        onSaved={() => { setShowForm(false); setEditRole(null); fetchRoles(); }}
        editRole={editRole}
      />
    </div>
  );
}
