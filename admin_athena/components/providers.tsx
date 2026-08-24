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
    // The admin console renders in LIGHT mode and deliberately does NOT follow
    // the OS/browser dark preference. Assistant/LLM text must always read as
    // dark ink on the light message surface; the active palette (fab-blue) has
    // no `.dark` variant, so applying `.dark` from the OS turned prose text
    // near-white on a white bubble (invisible). Dark mode is opt-in ONLY via an
    // explicit saved preference; with none set we force it OFF regardless of the
    // system theme. (No `prefers-color-scheme` listener — the OS never toggles it.)
    const savedTheme = localStorage.getItem("admin_athena_theme");
    document.documentElement.classList.toggle("dark", savedTheme === "dark");
  }, []);

  return (
    <ConfirmProvider>
      {children}
      <SessionExpiredModal open={sessionExpired} autoRedirectSeconds={5} />
    </ConfirmProvider>
  );
}
