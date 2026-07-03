"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  LayoutDashboard,
  Users,
  Shield,
  BarChart3,
  ScrollText,
  Settings,
  LogOut,
  MessageSquare,
  Wrench,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Menu,
} from "lucide-react";
import { useEffect, useState } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { label: "AI Chat", href: "/admin/chat", icon: MessageSquare },
    ],
  },
  {
    title: "People",
    items: [
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Roles", href: "/admin/roles", icon: Shield },
    ],
  },
  {
    title: "Configuration",
    items: [
      { label: "Models", href: "/admin/models", icon: Boxes },
      { label: "MCP Connections", href: "/admin/mcp", icon: Wrench },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { label: "Usage", href: "/admin/usage", icon: BarChart3 },
      { label: "Audit Logs", href: "/admin/audit-logs", icon: ScrollText },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Settings", href: "/admin/settings", icon: Settings },
    ],
  },
];

interface AdminUser {
  name?: string | null;
  email: string;
}

// Active item = solid blue (matches the approved design); inactive = muted.
const ACTIVE_BG = "var(--brand-indigo)";

function useLogout() {
  const router = useRouter();
  return async () => {
    const token = localStorage.getItem("admin_athena_token");
    if (token) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem("admin_athena_token");
    localStorage.removeItem("admin_athena_session");
    router.push("/");
  };
}

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname.startsWith(href);
}

/**
 * The navigation list. Shared between the desktop sidebar and the mobile drawer.
 * `collapsed` only applies to the desktop icon-rail mode; the mobile drawer
 * always renders the full-label layout. `onNavigate` lets the mobile drawer
 * close itself after a selection.
 */
function NavList({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const go = (href: string) => {
    router.push(href);
    onNavigate?.();
  };

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex-1 overflow-y-auto overflow-x-hidden",
        collapsed ? "px-2 py-2" : "px-2 pb-2 pt-5"
      )}
    >
      {navGroups.map((group) => (
        <div key={group.title} className={collapsed ? "mb-3" : "mb-4"}>
          {!collapsed && (
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
              {group.title}
            </p>
          )}
          <div className={collapsed ? "flex flex-col items-center gap-1.5" : ""}>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);
              const btn = (
                <Button
                  variant="ghost"
                  size={collapsed ? "icon" : "default"}
                  onClick={() => go(item.href)}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    "flex h-auto items-center justify-start rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [&_svg]:size-[18px]",
                    collapsed ? "h-10 w-10 justify-center" : "w-full gap-3 px-3 py-2",
                    active
                      ? "text-white hover:text-white"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                  style={active ? { backgroundColor: ACTIVE_BG } : undefined}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  {!collapsed && <span>{item.label}</span>}
                </Button>
              );
              return collapsed ? (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent side="right" className="border-0 bg-sidebar-active-navy font-medium text-white">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                <div key={item.href}>{btn}</div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({
  collapsed,
  user,
  onLogout,
}: {
  collapsed: boolean;
  user?: AdminUser;
  onLogout: () => void;
}) {
  return (
    <div className={cn("p-3", collapsed && "flex flex-col items-center")}>
      {!collapsed && user && (
        <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-sidebar-accent/40 px-2.5 py-2">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
            aria-hidden
          >
            {(user.name?.trim()?.[0] || user.email[0]).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user.name || "Admin"}
            </p>
            <p className="truncate text-xs text-sidebar-foreground/70">
              {user.email}
            </p>
          </div>
        </div>
      )}
      {collapsed && user && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
              aria-hidden
            >
              {(user.name?.trim()?.[0] || user.email[0]).toUpperCase()}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="border-0 bg-sidebar-active-navy font-medium text-white">{user.name || user.email}</TooltipContent>
        </Tooltip>
      )}
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 [&_svg]:size-[18px]"
              aria-label="Sign out"
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="border-0 bg-sidebar-active-navy font-medium text-white">Sign out</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          variant="ghost"
          onClick={onLogout}
          className="flex h-auto w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 [&_svg]:size-[18px]"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          <span>Sign out</span>
        </Button>
      )}
    </div>
  );
}

interface AdminSidebarProps {
  user?: AdminUser;
}

/**
 * Desktop sidebar — hidden below the `md` breakpoint where the mobile drawer
 * (AdminMobileNav) takes over.
 */
export function AdminSidebar({ user }: AdminSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const handleLogout = useLogout();

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          "hidden h-full flex-col border-r bg-sidebar transition-all duration-200 md:flex",
          collapsed ? "w-[72px]" : "w-64"
        )}
      >
        {/* Header */}
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
              <Shield className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed(false)}
              className="h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground"
              aria-label="Expand sidebar"
              aria-expanded={false}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <div className="flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
                <Shield className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold text-sidebar-foreground">Admin Console</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed(true)}
              className="h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground"
              aria-label="Collapse sidebar"
              aria-expanded={true}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        <NavList collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} user={user} onLogout={handleLogout} />
      </div>
    </TooltipProvider>
  );
}

/**
 * Mobile navigation — a hamburger button that opens the same navigation inside
 * a slide-in drawer. Rendered in the mobile top bar (see app/admin/layout.tsx).
 * Visible only below the `md` breakpoint.
 */
export function AdminMobileNav({ user }: AdminSidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const handleLogout = useLogout();

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="admin-mobile-nav"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>
      <SheetContent
        side="left"
        id="admin-mobile-nav"
        className="flex w-72 flex-col bg-sidebar p-0"
      >
        <SheetTitle className="flex h-14 items-center gap-2.5 px-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
            <Shield className="h-5 w-5 text-primary-foreground" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold text-sidebar-foreground">Admin Console</span>
        </SheetTitle>
        <NavList collapsed={false} onNavigate={() => setOpen(false)} />
        <SidebarFooter collapsed={false} user={user} onLogout={handleLogout} />
      </SheetContent>
    </Sheet>
  );
}
