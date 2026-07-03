"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";
import { AuthBrandingPanel } from "@/components/auth-branding-panel";

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<{ email: string; roleName: string } | null>(null);
  const [validationError, setValidationError] = useState("");

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setValidationError("No invitation token provided.");
      setLoading(false);
      return;
    }

    fetch(`/api/auth/validate-invitation?token=${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setValid(true);
          setInviteInfo({ email: data.email, roleName: data.roleName });
        } else {
          setValidationError(data.error || "Invalid invitation.");
        }
      })
      .catch(() => setValidationError("Failed to validate invitation."))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/accept-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create account");
        setSubmitting(false);
        return;
      }

      setSuccess(true);

      // Store session for Athena (the chat app)
      localStorage.setItem("llmatscale_auth_token", data.token);
      localStorage.setItem(
        "llmatscale_auth_session",
        JSON.stringify({
          user: data.user,
          expiresAt: data.expiresAt,
        })
      );

      // Redirect to Athena chat after a moment
      setTimeout(() => {
        const athenaUrl = process.env.NEXT_PUBLIC_ATHENA_URL || "http://localhost:3000";
        window.location.href = athenaUrl + "/chat";
      }, 2000);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  // Password requirements check
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password === confirmPassword && password.length > 0;

  return (
    <div className="flex h-full min-h-screen">
      <AuthBrandingPanel />

      {/* Right Panel */}
      <div className="flex flex-1 items-center justify-center bg-background px-6">
        <div className="w-full max-w-md space-y-6">
          {loading ? (
            <div className="flex flex-col items-center gap-4 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Validating invitation...</p>
            </div>
          ) : !valid ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <XCircle className="h-12 w-12 text-red-500" />
              <h2 className="text-xl font-semibold">Invalid Invitation</h2>
              <p className="text-muted-foreground">{validationError}</p>
            </div>
          ) : success ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <h2 className="text-xl font-semibold">Account Created!</h2>
              <p className="text-muted-foreground">
                Redirecting you to the platform...
              </p>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-3xl font-semibold">Create your account</h2>
                <p className="mt-2 text-muted-foreground">
                  You&apos;ve been invited as <strong>{inviteInfo?.roleName}</strong>
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email (readonly) */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
                  <Input value={inviteInfo?.email || ""} disabled className="h-11 bg-muted/50" />
                </div>

                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="reg-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Full Name</Label>
                  <Input
                    id="reg-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="Your full name"
                    className="h-11"
                    autoFocus
                  />
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="reg-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</Label>
                  <div className="relative">
                    <Input
                      id="reg-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Min. 8 characters"
                      className="h-11 pr-10"
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

                {/* Confirm Password */}
                <div className="space-y-2">
                  <Label htmlFor="reg-confirm" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Confirm Password</Label>
                  <Input
                    id="reg-confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    placeholder="Re-enter password"
                    className="h-11"
                  />
                </div>

                {/* Requirements */}
                {password.length > 0 && (
                  <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
                    <Requirement met={hasMinLength}>At least 8 characters</Requirement>
                    <Requirement met={hasUppercase}>One uppercase letter</Requirement>
                    <Requirement met={hasLowercase}>One lowercase letter</Requirement>
                    <Requirement met={hasNumber}>One number</Requirement>
                    {confirmPassword.length > 0 && (
                      <Requirement met={passwordsMatch}>Passwords match</Requirement>
                    )}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting || !hasMinLength || !passwordsMatch}
                  className="h-11 w-full rounded-lg bg-gradient-to-r from-[#5b21b6] via-[#7c3aed] to-[#c026d3] text-base text-white shadow-lg shadow-purple-800/30 hover:from-[#4c1d95] hover:via-[#6d28d9] hover:to-[#a21caf]"
                >
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Account"}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Powered by <span className="font-medium text-foreground">LLMatscale.ai</span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
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
