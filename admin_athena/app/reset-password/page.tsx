"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, XCircle, Eye, EyeOff, KeyRound } from "lucide-react";
import { AuthBrandingPanel } from "@/components/auth-branding-panel";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const hasMinLength = newPassword.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const passwordsMatch = newPassword === confirmPassword && newPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!passwordsMatch) {
      setError("Passwords do not match");
      return;
    }
    if (!hasMinLength) {
      setError("Password must be at least 8 characters");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to reset password");
        setSubmitting(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex h-full min-h-screen">
        <AuthBrandingPanel />
        <div className="flex flex-1 items-center justify-center bg-background">
          <div className="text-center">
            <XCircle className="mx-auto h-12 w-12 text-red-500" />
            <h2 className="mt-4 text-xl font-semibold">Invalid Reset Link</h2>
            <p className="mt-2 text-muted-foreground">No reset token provided.</p>
            <a href={process.env.NEXT_PUBLIC_ATHENA_URL || "/"} className="mt-4 inline-block text-sm text-primary underline">
              Back to login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-screen">
      <AuthBrandingPanel />
      <div className="flex flex-1 items-center justify-center bg-background px-6">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <KeyRound className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Reset your password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a new password for your account.
          </p>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-4 rounded-lg border bg-card p-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <h3 className="text-lg font-semibold">Password Reset!</h3>
            <p className="text-sm text-muted-foreground">
              Your password has been changed successfully. You can now log in with your new password.
            </p>
            <a
              href={process.env.NEXT_PUBLIC_ATHENA_URL || "/"}
              className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Go to Login
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                New Password
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  placeholder="Min. 8 characters"
                  className="h-11 pr-10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Confirm Password
              </Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Re-enter password"
                className="h-11"
              />
            </div>

            {/* Requirements */}
            {newPassword.length > 0 && (
              <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
                <Req met={hasMinLength}>At least 8 characters</Req>
                <Req met={hasUppercase}>One uppercase letter</Req>
                <Req met={hasLowercase}>One lowercase letter</Req>
                <Req met={hasNumber}>One number</Req>
                {confirmPassword.length > 0 && (
                  <Req met={passwordsMatch}>Passwords match</Req>
                )}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting || !hasMinLength || !passwordsMatch}
              className="h-11 w-full rounded-lg bg-gradient-to-r from-[#5b21b6] via-[#7c3aed] to-[#c026d3] text-white shadow-lg shadow-purple-800/30 hover:from-[#4c1d95] hover:via-[#6d28d9] hover:to-[#a21caf]"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Reset Password"}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <a href={process.env.NEXT_PUBLIC_ATHENA_URL || "/"} className="text-primary underline">Back to login</a>
        </p>
      </div>
      </div>
    </div>
  );
}

function Req({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {met ? (
        <CheckCircle className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
      )}
      <span className={met ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}>
        {children}
      </span>
    </div>
  );
}
