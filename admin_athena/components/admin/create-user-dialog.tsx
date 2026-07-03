"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { Loader2, Mail, CheckCircle } from "lucide-react";

interface RoleMeta { id: string; name: string }

interface CreateUserDialogProps {
  roles: RoleMeta[];
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateUserDialog({ roles, open, onClose, onCreated }: CreateUserDialogProps) {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [acceptUrl, setAcceptUrl] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleId) {
      toast.error("Please select a role");
      return;
    }
    setSubmitting(true);

    const token = localStorage.getItem("admin_athena_token");
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, roleId }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to send invitation");
        setSubmitting(false);
        return;
      }

      setSent(true);
      setAcceptUrl(data.acceptUrl || "");
      toast.success(`Invitation sent to ${email}`);
      onCreated();
    } catch {
      toast.error("Failed to send invitation");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setEmail("");
    setRoleId("");
    setSent(false);
    setAcceptUrl("");
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Invite User</SheetTitle>
          <SheetDescription>
            Send an invitation email. The user will set their own password.
          </SheetDescription>
        </SheetHeader>

        {sent ? (
          <div className="mt-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle className="h-12 w-12 text-green-500" aria-hidden="true" />
            <h3 className="text-lg font-semibold">Invitation Sent!</h3>
            <p className="text-sm text-muted-foreground">
              An invitation email has been sent to <strong>{email}</strong>.
              They will receive a link to create their account.
            </p>
            {acceptUrl && (
              <div className="mt-4 w-full space-y-2">
                <p className="text-xs text-muted-foreground">
                  Dev: If email is not configured, share this link directly:
                </p>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <code className="break-all text-xs">{acceptUrl}</code>
                </div>
              </div>
            )}
            <Button onClick={handleClose} className="mt-4 w-full">Done</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="user@company.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select a role...</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                The user will receive an email with a link to set their password and create their account. The invitation expires in 7 days.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row">
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" aria-hidden="true" /> Send Invitation
                  </>
                )}
              </Button>
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
