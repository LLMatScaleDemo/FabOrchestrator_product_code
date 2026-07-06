"use client";

import { useEffect, useState, useCallback } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Plus, Boxes, Trash2, Loader2, Pencil, AlertTriangle } from "lucide-react";

type ThinkingType = "none" | "adaptive" | "manual";

interface Model {
  id: string;
  modelId: string;
  displayName: string;
  description: string | null;
  inputCostPer1M: number;
  outputCostPer1M: number;
  cacheReadCostPer1M: number;
  cacheWriteCostPer1M: number;
  thinkingType: ThinkingType;
  thinkingBudget: number | null;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
}

const THINKING_LABELS: Record<ThinkingType, string> = {
  none: "None",
  adaptive: "Adaptive",
  manual: "Manual",
};

const fmtCost = (n: number) => `$${Number(n).toFixed(2)}`;

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Model | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();

  const token = typeof window !== "undefined" ? localStorage.getItem("admin_athena_token") : null;

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/model-registry", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setModels(data.models || []);
    } catch {
      toast.error("Failed to load models");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (m: Model) => {
    const ok = await confirm({
      title: `Delete "${m.displayName}"?`,
      description: m.isDefault
        ? "This is the current default model. Deleting it leaves no default until you set another."
        : "This permanently removes the model from the registry.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(m.id);
    try {
      const res = await fetch(`/api/admin/model-registry/${m.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Failed to delete");
        return;
      }
      toast.success(`"${m.displayName}" deleted`);
      fetchData();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AdminPageHeader
        title="Models"
        description="Manage the catalog of selectable AI models, their pricing, and thinking behavior."
      >
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="bg-primary">
          <Plus className="mr-2 h-4 w-4" /> Add Model
        </Button>
      </AdminPageHeader>

      {!loading && models.length === 0 && (
        <div className="mt-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            No models found. If the registry table isn&apos;t migrated yet, run{" "}
            <code className="font-mono">prisma/create_model_registry.sql</code> against the database.
          </p>
        </div>
      )}

      <div className="mt-6 max-h-[calc(100vh-20rem)] overflow-auto rounded-lg border">
        <Table className="min-w-[840px] text-base">
          <TableCaption className="sr-only">Registry of AI models with pricing, thinking mode, and default status.</TableCaption>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead scope="col" className="h-auto bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Display Name</TableHead>
              <TableHead scope="col" className="h-auto bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Model ID</TableHead>
              <TableHead scope="col" className="h-auto bg-muted/50 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Input $/1M</TableHead>
              <TableHead scope="col" className="h-auto bg-muted/50 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output $/1M</TableHead>
              <TableHead scope="col" className="h-auto bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Thinking</TableHead>
              <TableHead scope="col" className="h-auto bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active</TableHead>
              <TableHead scope="col" className="h-auto bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Default</TableHead>
              <TableHead scope="col" className="h-auto bg-muted/50 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child]:border-b">
            {loading ? (
              [...Array(3)].map((_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell colSpan={8} className="whitespace-normal px-4 py-4"><div className="h-4 w-64 animate-pulse rounded bg-muted" /></TableCell>
                </TableRow>
              ))
            ) : models.length === 0 ? (
              <TableRow className="border-b-0! hover:bg-transparent">
                <TableCell colSpan={8} className="whitespace-normal px-4 py-14 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                    <Boxes className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-medium text-foreground">No models yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">Add a model to make it selectable in chat.</p>
                    </div>
                    <Button onClick={() => { setEditing(null); setDialogOpen(true); }} size="sm" className="mt-1 bg-primary">
                      <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Add Model
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="px-4 py-3 font-medium">{m.displayName}</TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.modelId}</TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums">{fmtCost(m.inputCostPer1M)}</TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums">{fmtCost(m.outputCostPer1M)}</TableCell>
                  <TableCell className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">
                      {THINKING_LABELS[m.thinkingType]}
                      {m.thinkingType === "manual" && m.thinkingBudget != null ? ` · ${m.thinkingBudget}` : ""}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {m.isActive ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {m.isDefault ? <Badge className="bg-primary text-primary-foreground">Default</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer" onClick={() => { setEditing(m); setDialogOpen(true); }} title="Edit" aria-label={`Edit ${m.displayName}`}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer text-destructive hover:text-destructive" disabled={busyId === m.id} onClick={() => handleDelete(m)} title="Delete" aria-label={`Delete ${m.displayName}`}>
                        {busyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ModelDialog
        open={dialogOpen}
        editing={editing}
        token={token}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { setDialogOpen(false); fetchData(); }}
      />
    </div>
  );
}

// ── Add / Edit Model ──
function ModelDialog({ open, editing, token, onClose, onSaved }: {
  open: boolean;
  editing: Model | null;
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [modelId, setModelId] = useState("");
  const [description, setDescription] = useState("");
  const [inputCost, setInputCost] = useState("0");
  const [outputCost, setOutputCost] = useState("0");
  const [cacheReadCost, setCacheReadCost] = useState("0");
  const [cacheWriteCost, setCacheWriteCost] = useState("0");
  const [thinkingType, setThinkingType] = useState<ThinkingType>("adaptive");
  const [thinkingBudget, setThinkingBudget] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [sortOrder, setSortOrder] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ displayName?: string; modelId?: string }>({});

  useEffect(() => {
    if (open) {
      setErrors({});
      setDisplayName(editing?.displayName || "");
      setModelId(editing?.modelId || "");
      setDescription(editing?.description || "");
      setInputCost(String(editing?.inputCostPer1M ?? 0));
      setOutputCost(String(editing?.outputCostPer1M ?? 0));
      setCacheReadCost(String(editing?.cacheReadCostPer1M ?? 0));
      setCacheWriteCost(String(editing?.cacheWriteCostPer1M ?? 0));
      setThinkingType(editing?.thinkingType || "adaptive");
      setThinkingBudget(editing?.thinkingBudget != null ? String(editing.thinkingBudget) : "");
      setIsActive(editing ? editing.isActive : true);
      setIsDefault(editing ? editing.isDefault : false);
      setSortOrder(String(editing?.sortOrder ?? 0));
    }
  }, [open, editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: { displayName?: string; modelId?: string } = {};
    if (!displayName.trim()) nextErrors.displayName = "Display name is required.";
    if (!modelId.trim()) nextErrors.modelId = "Model ID is required.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        displayName: displayName.trim(),
        modelId: modelId.trim(),
        description: description.trim(),
        inputCostPer1M: Number(inputCost) || 0,
        outputCostPer1M: Number(outputCost) || 0,
        cacheReadCostPer1M: Number(cacheReadCost) || 0,
        cacheWriteCostPer1M: Number(cacheWriteCost) || 0,
        thinkingType,
        thinkingBudget: thinkingType === "manual" && thinkingBudget !== "" ? Number(thinkingBudget) : null,
        isActive,
        isDefault,
        sortOrder: Number(sortOrder) || 0,
      };
      const res = await fetch(editing ? `/api/admin/model-registry/${editing.id}` : "/api/admin/model-registry", {
        method: editing ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Failed to save");
        setSubmitting(false);
        return;
      }
      toast.success(editing ? "Model updated" : "Model added");
      onSaved();
    } catch {
      toast.error("Failed to save model");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit Model" : "Add Model"}</SheetTitle>
          <SheetDescription>Configure a selectable AI model, its token pricing, and thinking behavior.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model-display-name">Display Name <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Input id="model-display-name" value={displayName} onChange={(e) => { setDisplayName(e.target.value); if (errors.displayName) setErrors((p) => ({ ...p, displayName: undefined })); }} placeholder="FabOrchestrator 2.0" required aria-required="true" aria-invalid={!!errors.displayName} aria-describedby={errors.displayName ? "model-display-name-error" : undefined} />
            {errors.displayName && <p id="model-display-name-error" className="text-sm text-destructive">{errors.displayName}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="model-id">Model ID <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Input id="model-id" value={modelId} onChange={(e) => { setModelId(e.target.value); if (errors.modelId) setErrors((p) => ({ ...p, modelId: undefined })); }} placeholder="claude-opus-4-8" required aria-required="true" aria-invalid={!!errors.modelId} aria-describedby={errors.modelId ? "model-id-error" : "model-id-help"} />
            {errors.modelId ? <p id="model-id-error" className="text-sm text-destructive">{errors.modelId}</p> : <p id="model-id-help" className="text-xs text-muted-foreground">The exact API model identifier (e.g. claude-opus-4-8).</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="model-description">Description <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="model-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this model is best for" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="model-input-cost">Input $/1M</Label>
              <Input id="model-input-cost" type="number" min="0" step="0.01" value={inputCost} onChange={(e) => setInputCost(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model-output-cost">Output $/1M</Label>
              <Input id="model-output-cost" type="number" min="0" step="0.01" value={outputCost} onChange={(e) => setOutputCost(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model-cache-read-cost">Cache Read $/1M</Label>
              <Input id="model-cache-read-cost" type="number" min="0" step="0.01" value={cacheReadCost} onChange={(e) => setCacheReadCost(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model-cache-write-cost">Cache Write $/1M</Label>
              <Input id="model-cache-write-cost" type="number" min="0" step="0.01" value={cacheWriteCost} onChange={(e) => setCacheWriteCost(e.target.value)} className="tabular-nums" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="model-thinking-type">Thinking Type</Label>
            <Select value={thinkingType} onValueChange={(v) => setThinkingType(v as ThinkingType)}>
              <SelectTrigger id="model-thinking-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="adaptive">Adaptive</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {thinkingType === "manual" && (
            <div className="space-y-2">
              <Label htmlFor="model-thinking-budget">Thinking Budget (tokens)</Label>
              <Input id="model-thinking-budget" type="number" min="0" step="1" value={thinkingBudget} onChange={(e) => setThinkingBudget(e.target.value)} placeholder="e.g. 8000" className="tabular-nums" />
              <p className="text-xs text-muted-foreground">Fixed reasoning-token budget applied to every request.</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="model-sort-order">Sort Order</Label>
            <Input id="model-sort-order" type="number" step="1" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="tabular-nums" />
            <p className="text-xs text-muted-foreground">Lower numbers appear first in the model picker.</p>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isActive} onCheckedChange={(c) => setIsActive(!!c)} />
              <span>Active (selectable by users)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isDefault} onCheckedChange={(c) => setIsDefault(!!c)} />
              <span>Default (only one model can be default)</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting} className="bg-primary">
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</> : editing ? "Save Changes" : "Add Model"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
