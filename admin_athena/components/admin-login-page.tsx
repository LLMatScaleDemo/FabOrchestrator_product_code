"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";
import { AuthBrandingPanel } from "@/components/auth-branding-panel";

export function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    setMounted(true);
    const session = localStorage.getItem("admin_athena_session");
    const token = localStorage.getItem("admin_athena_token");
    if (session && token) {
      try {
        const parsed = JSON.parse(session);
        if (parsed.expiresAt && new Date(parsed.expiresAt) > new Date()) {
          router.replace("/admin/chat");
          return;
        }
      } catch {
        // Invalid session, clear it
        localStorage.removeItem("admin_athena_session");
        localStorage.removeItem("admin_athena_token");
      }
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        setIsSubmitting(false);
        return;
      }

      // Store session
      localStorage.setItem("admin_athena_token", data.token);
      localStorage.setItem(
        "admin_athena_session",
        JSON.stringify({
          user: data.user,
          expiresAt: data.expiresAt,
        })
      );

      router.push("/admin/chat");
    } catch {
      setError("Network error. Please try again.");
      setIsSubmitting(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="flex h-full min-h-screen">
      <AuthBrandingPanel />

      {/* Right Panel - Simple admin sign in */}
      <div className="flex flex-1 items-center justify-center bg-background px-6">
        <div className="w-full max-w-[360px] space-y-5">
          {/* Header */}
          <div>
            <h2 className="text-2xl font-bold text-foreground">Admin Sign In</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to the admin console to continue.
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                className="h-11 rounded-lg border-border bg-background text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="h-11 rounded-lg border-border bg-background pr-11 text-sm"
                />
                <Button
                  type="button"
                  variant="link"
                  size="icon"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 h-auto w-auto -translate-y-1/2 text-muted-foreground transition-none hover:text-foreground [&_svg]:size-5"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </Button>
              </div>
              <div className="flex justify-end">
                <a href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  Forgot password?
                </a>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !email || !password}
              className="h-11 w-full rounded-lg bg-gradient-to-r from-auth-grad-from via-auth-grad-via to-auth-grad-to text-base font-medium text-white shadow-lg shadow-purple-800/30 hover:from-auth-grad-from-2 hover:via-auth-grad-via-2 hover:to-auth-grad-to-2"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Sign in
                  <ArrowRight className="ml-2 h-5 w-5" />
                </>
              )}
            </Button>
          </form>

          {/* Footer */}
          <div className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">
              Powered by{" "}
              <span className="font-medium text-foreground">LLMatscale.ai</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
