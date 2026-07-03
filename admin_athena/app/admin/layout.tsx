"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminSidebar, AdminMobileNav } from "@/components/admin/admin-sidebar";

interface SessionData {
  user: { id: string; email: string; name?: string | null; isAdmin: boolean };
  expiresAt: string;
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("admin_athena_token");
    const sessionStr = localStorage.getItem("admin_athena_session");

    if (!token || !sessionStr) {
      router.replace("/");
      return;
    }

    try {
      const parsed: SessionData = JSON.parse(sessionStr);
      if (new Date(parsed.expiresAt) < new Date()) {
        localStorage.removeItem("admin_athena_token");
        localStorage.removeItem("admin_athena_session");
        router.replace("/");
        return;
      }

      if (!parsed.user.isAdmin) {
        router.replace("/");
        return;
      }

      setSession(parsed);
      setLoading(false);
    } catch {
      router.replace("/");
    }
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Mobile top bar — provides nav access where the static sidebar is hidden. */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar px-3 md:hidden">
        <AdminMobileNav user={session?.user} />
        <span className="text-sm font-semibold text-sidebar-foreground">Admin Console</span>
      </header>

      <AdminSidebar user={session?.user} />

      <main
        id="main-content"
        tabIndex={0}
        className="flex-1 overflow-y-auto bg-background focus:outline-none"
      >
        {children}
      </main>
    </div>
  );
}
