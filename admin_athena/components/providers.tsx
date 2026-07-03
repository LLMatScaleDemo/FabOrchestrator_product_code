"use client";

import * as React from "react";
import { useEffect } from "react";
import { SessionExpiredModal } from "./session-expired-modal";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

export function Providers({ children }: { children: React.ReactNode }) {
  const [sessionExpired, setSessionExpired] = React.useState(false);

  // Patch window.fetch on mount: any 401 with type=SESSION_TIMEOUT
  // shows the friendly modal + auto-redirect, replacing the raw JSON
  // error UX. We exempt the login page itself (which intentionally
  // posts to /api/auth/login and may receive 401 on bad credentials —
  // those are NOT session-timeout responses).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === "/") return;

    const original = window.fetch.bind(window);
    let triggered = false;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      if (!triggered && res.status === 401) {
        try {
          const cloned = res.clone();
          const data = await cloned.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = (data as any)?.error?.type;
          if (t === "SESSION_TIMEOUT") {
            triggered = true;
            setSessionExpired(true);
          }
        } catch {
          // not JSON
        }
      }
      return res;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  // Apply the admin-controlled global color theme on load. Always sets
  // data-theme (including "claude") so the explicit palette block in
  // globals.css is used; reconciles the static default from layout.tsx.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/theme", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const theme = d?.colorTheme || "fab-blue";
        document.documentElement.setAttribute("data-theme", theme);
      })
      .catch(() => { /* keep static default */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Initialize theme from localStorage
    const savedTheme = localStorage.getItem("admin_athena_theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem("admin_athena_theme");
      if (!saved || saved === "system") {
        document.documentElement.classList.toggle("dark", e.matches);
      }
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return (
    <ConfirmProvider>
      {children}
      <SessionExpiredModal open={sessionExpired} autoRedirectSeconds={5} />
    </ConfirmProvider>
  );
}
