"use client";

/**
 * Secure "create MCP data source" upload dialog.
 *
 * Opened when the admin attaches a credentials document in the chat composer.
 * The file is posted DIRECTLY to /api/admin/mcp/secrets (multipart) — it is NEVER
 * added to the chat/conversation, so its contents never reach the model,
 * messages, or prompt_audit_logs. The backend parses it in memory, stores the
 * secret in AWS Secrets Manager, and returns only non-secret metadata.
 */
import { useEffect, useState } from "react";
import { X, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CreatedDataSource {
  id: string;
  name: string;
  status: string;
  metadata: { engine: string; host: string; port: number; database: string; schemas: string[] };
}

interface Props {
  open: boolean;
  file: File | null;
  defaultName?: string;
  token: string | null;
  onClose: () => void;
  onCreated?: (result: CreatedDataSource) => void;
}

export function MCPDataSourceUploadDialog({ open, file, defaultName, token, onClose, onCreated }: Props) {
  const [name, setName] = useState(defaultName || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName || "");
      setError(null);
      setSubmitting(false);
    }
  }, [open, defaultName]);

  if (!open || !file) return null;

  async function handleCreate() {
    setError(null);
    if (!name.trim()) return setError("Give the data source a name.");
    if (!file) return setError("No file attached.");

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", name.trim());
      form.append("engine", "sqlserver"); // v1 scope: SQL Server
      form.append("schemas", "[]");        // empty = auto-discover everything

      const res = await fetch("/api/admin/mcp/secrets", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.missingFields?.length
          ? `Missing in the document: ${json.missingFields.join(", ")}`
          : json?.detail || json?.error || "Upload failed";
        setError(detail);
        setSubmitting(false);
        return;
      }
      toast.success(`Data source "${json.name}" created — credentials stored securely.`);
      onCreated?.(json as CreatedDataSource);
      onClose();
    } catch {
      setError("Network error while creating the data source.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Create MCP data source">
      <div className="w-full max-w-md rounded-2xl bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-blue-600" aria-hidden="true" />
            <h2 className="text-base font-semibold">Create MCP data source</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <p className="mb-4 text-xs text-muted-foreground">
          The credentials file <span className="font-medium text-foreground">{file.name}</span> is sent
          straight to AWS Secrets Manager and is <span className="font-medium">never shared with the chat or the model</span>.
          Only non-secret metadata (host, database, schema list) is stored.
        </p>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ds-name">Data source name</Label>
            <Input id="ds-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warehouse Database" disabled={submitting} />
            <p className="text-[11px] text-muted-foreground">A friendly name you&apos;ll recognise. We&apos;ll connect and find the available information automatically.</p>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? (<><Loader2 className="mr-1 size-4 animate-spin" /> Creating…</>) : "Create securely"}
          </Button>
        </div>
      </div>
    </div>
  );
}
