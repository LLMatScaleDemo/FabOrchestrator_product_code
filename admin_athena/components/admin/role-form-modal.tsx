"use client";

import { useState, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { Loader2, Wrench, Plus, X } from "lucide-react";
import { ALL_MODELS } from "@/lib/constants/role-templates";

interface AssignedMcp { id: string; name: string }
interface CatalogConnector { id: string; displayName: string; isActive: boolean }

function RoleMcpSection({ roleId }: { roleId: string }) {
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
        fetch(`/api/admin/mcp?roleId=${roleId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/admin/mcp-registry`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const a = await aRes.json(); const c = await cRes.json();
      setAssigned(a.connections || []);
      setCatalog((c.servers || []).filter((s: CatalogConnector) => s.isActive));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [token, roleId]);

  useEffect(() => { load(); }, [load]);

  const assign = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ registryId: pick, roleId }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || "Failed to attach"); return; }
      toast.success("MCP attached to role");
      setPick(""); load();
    } catch { toast.error("Failed to attach"); } finally { setBusy(false); }
  };

  const remove = async (connId: string, name: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/mcp/${connId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { toast.error("Failed to remove"); return; }
      toast.success(`"${name}" removed`); load();
    } catch { toast.error("Failed to remove"); } finally { setBusy(false); }
  };

  const available = catalog.filter((c) => !assigned.some((a) => a.name === c.displayName));

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <p className="text-sm font-medium">Role MCP Access</p>
      <p className="text-xs text-muted-foreground">Connectors attached here are available to every user in this role.</p>
      {loading ? (
        <div className="h-8 animate-pulse rounded-md bg-muted" />
      ) : (
        <>
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">None attached.</p>
          ) : (
            <div className="space-y-1.5">
              {assigned.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
                  <Wrench className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy} onClick={() => remove(m.id, m.name)} title="Remove" aria-label={`Remove ${m.name}`}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Select value={pick} onValueChange={setPick} disabled={available.length === 0}>
              <SelectTrigger aria-label="Attach MCP connector to role" className="h-9 w-full flex-1">
                <SelectValue placeholder={available.length ? "Attach a connector..." : "All active connectors attached"} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {available.map((c) => <SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button type="button" size="sm" disabled={!pick || busy} onClick={assign} aria-label="Attach connector">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface RoleFormData {
  name: string;
  description: string;
  permissions: string[];
  allowedModels: string[];
  systemInstructions: string;
  customInstructionsEnabled: boolean;
  customInstructionsMaxLength: number;
  personalMcpEnabled: boolean;
  personalMcpMaxCount: number;
  dailyRequestLimit: number | null;
  dailyTokenLimit: number | null;
}

 
interface RoleFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  // Loosely-typed role record hydrated from the API (fields read with guards below).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editRole?: Record<string, any> | null;
}

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Claude 4.6 Opus',
  'claude-sonnet-4-6': 'Claude 4.6 Sonnet',
  'claude-sonnet-4-5-20250929': 'Claude 4.5 Sonnet',
  'claude-haiku-4-5-20251001': 'Claude 4.5 Haiku',
  'claude-opus-4-5-20251101': 'Claude 4.5 Opus',
  'claude-opus-4-20250514': 'Claude 4 Opus',
  'claude-sonnet-4-20250514': 'Claude 4 Sonnet',
};

const defaultForm: RoleFormData = {
  name: "", description: "", permissions: ["chat"], allowedModels: [],
  systemInstructions: "", customInstructionsEnabled: true,
  customInstructionsMaxLength: 1000, personalMcpEnabled: false,
  personalMcpMaxCount: 3, dailyRequestLimit: null, dailyTokenLimit: null,
};

export function RoleFormModal({ open, onClose, onSaved, editRole }: RoleFormModalProps) {
  const [form, setForm] = useState<RoleFormData>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<"general" | "models" | "limits" | "tools">("general");
  const [errors, setErrors] = useState<{ name?: string; models?: string }>({});

  useEffect(() => {
    if (editRole) {
      setForm({
        name: editRole.name || "",
        description: editRole.description || "",
        permissions: Array.isArray(editRole.permissions) ? editRole.permissions : [],
        allowedModels: Array.isArray(editRole.allowedModels) ? editRole.allowedModels : [],
        systemInstructions: editRole.systemInstructions || "",
        customInstructionsEnabled: editRole.customInstructionsEnabled ?? true,
        customInstructionsMaxLength: editRole.customInstructionsMaxLength ?? 1000,
        personalMcpEnabled: editRole.personalMcpEnabled ?? false,
        personalMcpMaxCount: editRole.personalMcpMaxCount ?? 3,
        dailyRequestLimit: editRole.dailyRequestLimit ?? null,
        dailyTokenLimit: editRole.dailyTokenLimit ?? null,
      });
    } else {
      setForm(defaultForm);
    }
    setTab("general");
    setErrors({});
  }, [editRole, open]);

  const toggleModel = (m: string) => {
    setErrors((p) => ({ ...p, models: undefined }));
    setForm((f) => ({
      ...f,
      allowedModels: f.allowedModels.includes(m)
        ? f.allowedModels.filter((x) => x !== m)
        : [...f.allowedModels, m],
    }));
  };

  const handleSubmit = async () => {
    const nextErrors: { name?: string; models?: string } = {};
    if (!form.name.trim()) nextErrors.name = "Role name is required.";
    if (form.allowedModels.length === 0) nextErrors.models = "Select at least one model.";
    setErrors(nextErrors);
    if (nextErrors.name) { setTab("general"); toast.error("Please fix the highlighted fields"); return; }
    if (nextErrors.models) { setTab("models"); toast.error("Select at least one model"); return; }

    setSubmitting(true);
    const token = localStorage.getItem("admin_athena_token");

    try {
      const url = editRole ? `/api/admin/roles/${editRole.id}` : "/api/admin/roles";
      const method = editRole ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to save role");
        setSubmitting(false);
        return;
      }

      toast.success(editRole ? "Role updated" : "Role created");
      onSaved();
    } catch {
      toast.error("Failed to save role");
    } finally {
      setSubmitting(false);
    }
  };

  const tabs = [
    { id: "general" as const, label: "General" },
    { id: "models" as const, label: "Models" },
    { id: "limits" as const, label: "Limits" },
    { id: "tools" as const, label: "MCP" },
  ];

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editRole ? "Edit Role" : "Create Role"}</SheetTitle>
          <SheetDescription>Configure role access and limits</SheetDescription>
        </SheetHeader>

        {/* Tabs */}
        <div className="mt-4 flex gap-1 rounded-lg bg-muted p-1">
          {tabs.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`h-auto flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id ? "bg-background text-foreground shadow-sm hover:bg-background" : "text-muted-foreground hover:bg-transparent hover:text-foreground"
              }`}
            >
              {t.label}
            </Button>
          ))}
        </div>

        <div className="mt-6 space-y-4">
          {/* General Tab */}
          {tab === "general" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="role-name">Name <span className="text-destructive" aria-hidden="true">*</span></Label>
                <Input id="role-name" value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); if (errors.name) setErrors((p) => ({ ...p, name: undefined })); }} placeholder="e.g. Data Analyst" aria-required="true" aria-invalid={!!errors.name} aria-describedby={errors.name ? "role-name-error" : undefined} />
                {errors.name && <p id="role-name-error" className="text-sm text-destructive">{errors.name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-description">Description</Label>
                <Input id="role-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description of this role" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-system-instructions">System Instructions</Label>
                <Textarea
                  id="role-system-instructions"
                  value={form.systemInstructions}
                  onChange={(e) => setForm({ ...form, systemInstructions: e.target.value })}
                  placeholder="Instructions appended to the system prompt for users in this role..."
                  className="field-sizing-fixed min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-none transition-none placeholder:text-muted-foreground focus-visible:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-background"
                  maxLength={2000}
                />
                <p className="text-xs text-muted-foreground">{form.systemInstructions.length}/2000 characters</p>
              </div>
              <div className="space-y-2">
                <Label>Features</Label>
                <label className="flex cursor-pointer items-center gap-3 rounded-md p-2 transition-colors hover:bg-muted/50">
                  <Checkbox
                    checked={form.permissions.includes("modeling_agent")}
                    onCheckedChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        permissions:
                          v === true
                            ? Array.from(new Set([...f.permissions, "modeling_agent"]))
                            : f.permissions.filter((p) => p !== "modeling_agent"),
                      }))
                    }
                  />
                  <span className="text-sm font-medium">
                    Modeling Agent{" "}
                    <span className="font-normal text-muted-foreground">
                      — enable the CMF master-data loader for this role
                    </span>
                  </span>
                </label>
              </div>
            </>
          )}

          {/* Models Tab */}
          {tab === "models" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Select which Claude models users with this role can access: <span className="text-destructive" aria-hidden="true">*</span></p>
              {errors.models && <p className="text-sm text-destructive">{errors.models}</p>}
              <div className="flex justify-between">
                <Button variant="outline" size="sm" onClick={() => setForm({ ...form, allowedModels: [...ALL_MODELS] })}>Select All</Button>
                <Button variant="outline" size="sm" onClick={() => setForm({ ...form, allowedModels: [] })}>Clear All</Button>
              </div>
              <Separator />
              {ALL_MODELS.map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-3 rounded-md p-2 transition-colors hover:bg-muted/50">
                  <Checkbox
                    checked={form.allowedModels.includes(m)}
                    onCheckedChange={() => toggleModel(m)}
                  />
                  <span className="text-sm font-medium">{MODEL_LABELS[m] || m}</span>
                </label>
              ))}
            </div>
          )}

          {/* Limits Tab */}
          {tab === "limits" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="role-daily-request-limit">Daily Request Limit</Label>
                <Input
                  id="role-daily-request-limit"
                  type="number"
                  value={form.dailyRequestLimit ?? ""}
                  onChange={(e) => setForm({ ...form, dailyRequestLimit: e.target.value ? Number(e.target.value) : null })}
                  placeholder="Unlimited"
                  min={1}
                />
                <p className="text-xs text-muted-foreground">Max requests per 24-hour rolling window. Empty = unlimited.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-daily-token-limit">Daily Token Limit</Label>
                <Input
                  id="role-daily-token-limit"
                  type="number"
                  value={form.dailyTokenLimit ?? ""}
                  onChange={(e) => setForm({ ...form, dailyTokenLimit: e.target.value ? Number(e.target.value) : null })}
                  placeholder="Unlimited"
                  min={1}
                />
                <p className="text-xs text-muted-foreground">Max tokens per 24-hour rolling window. Empty = unlimited.</p>
              </div>
              <Separator />
              <div className="space-y-2">
                <label className="flex items-center gap-3">
                  <Checkbox checked={form.customInstructionsEnabled} onCheckedChange={(v) => setForm({ ...form, customInstructionsEnabled: v === true })} />
                  <span className="text-sm">Allow custom instructions</span>
                </label>
                {form.customInstructionsEnabled && (
                  <div className="ml-7 space-y-2">
                    <Label htmlFor="role-custom-instructions-max-length">Max Length</Label>
                    <Input id="role-custom-instructions-max-length" type="number" value={form.customInstructionsMaxLength} onChange={(e) => setForm({ ...form, customInstructionsMaxLength: Number(e.target.value) })} min={0} max={5000} />
                  </div>
                )}
              </div>
            </>
          )}

          {/* MCP Tab */}
          {tab === "tools" && (
            <div className="space-y-4">
              {editRole?.id ? (
                <RoleMcpSection roleId={editRole.id} />
              ) : (
                <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                  Save the role first, then reopen it to attach MCP connectors.
                </p>
              )}
              <Separator />
              <p className="text-sm text-muted-foreground">Control whether users in this role can add their own MCP connections.</p>
              <label className="flex items-center gap-3">
                <Checkbox checked={form.personalMcpEnabled} onCheckedChange={(v) => setForm({ ...form, personalMcpEnabled: v === true })} />
                <span className="text-sm font-medium">Allow Personal MCP Connections</span>
              </label>
              {form.personalMcpEnabled && (
                <div className="ml-7 space-y-2">
                  <Label htmlFor="role-personal-mcp-max-count">Max MCP Connections</Label>
                  <Input id="role-personal-mcp-max-count" type="number" value={form.personalMcpMaxCount} onChange={(e) => setForm({ ...form, personalMcpMaxCount: Number(e.target.value) })} min={1} max={20} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
          <Button onClick={handleSubmit} disabled={submitting} className="flex-1">
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</> : editRole ? "Update Role" : "Create Role"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
