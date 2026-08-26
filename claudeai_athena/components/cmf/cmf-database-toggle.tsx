"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CMF_ACTIVE_DB_KEY } from "@/lib/cmf/client-auth";

/**
 * Per-user selector for WHICH CMF database the Modeling Agent uses.
 *
 * The list of databases is DYNAMIC — fetched from `/api/cmf/connections`, which
 * returns every enabled admin-managed connection. A connection added in the admin
 * app appears here automatically. Exactly ONE is active at a time, used for both
 * export (read) and load (write). To move data across databases, export against
 * one, switch, then load against the other — the staged file is environment-
 * independent, so this works without a separate load selector.
 *
 * The choice persists in the user's settings (`preferences.cmfDb` /
 * `preferences.cmfLoadDbKey`) and is sent up with every chat request via the
 * `onChange` callback (as `{ cmfDbs, loadDbKey }`, which the chat route reads).
 */

export type CmfDbKey = string;
export type CmfDbSelection = {
  cmfDbs: Record<CmfDbKey, boolean>;
  loadDbKey: CmfDbKey;
};

type DbOption = { key: string; label: string };

/** Fallback list if the connections API can't be reached (matches the built-ins). */
const DEFAULT_DBS: DbOption[] = [
  { key: "source", label: "Entegris / KSP" },
  { key: "target", label: "OOB" },
];

/** Build the request-shaped selection (one active DB) from the current db list. */
function selectionFor(active: string, dbs: DbOption[]): CmfDbSelection {
  // No accessible database → send an empty selection (the server also enforces).
  if (!active) return { cmfDbs: {}, loadDbKey: "" };
  const cmfDbs: Record<string, boolean> = {};
  for (const d of dbs) cmfDbs[d.key] = d.key === active;
  cmfDbs[active] = true;
  return { cmfDbs, loadDbKey: active };
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("llmatscale_auth_token") : null;
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

export function CmfDatabaseToggle({
  onChange,
  className,
}: {
  onChange: (sel: CmfDbSelection) => void;
  className?: string;
}) {
  const [dbs, setDbs] = useState<DbOption[]>(DEFAULT_DBS);
  const [active, setActive] = useState<string>(DEFAULT_DBS[0].key);
  const [open, setOpen] = useState(false);
  // Keep the full preferences blob so a PATCH doesn't clobber other settings.
  const prefsRef = useRef<Record<string, unknown>>({});
  // Mirrors `active` so `apply` (a []-dep callback) can compare against the
  // previous value without going stale.
  const activeRef = useRef<string>(DEFAULT_DBS[0].key);
  const dbsRef = useRef<DbOption[]>(DEFAULT_DBS);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const labelFor = useCallback(
    (key: string) => dbsRef.current.find((d) => d.key === key)?.label ?? key,
    [],
  );

  // Load the dynamic DB list + the saved selection once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) Fetch the databases the user is GRANTED (server filters by access).
      //    An empty array is a valid answer ("no access") and is honored — only a
      //    failed request falls back to the built-ins for resilience.
      let list = DEFAULT_DBS;
      try {
        const r = await fetch("/api/cmf/connections", { headers: authHeaders() });
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d?.connections)) list = d.connections;
        }
      } catch {
        /* request failed — keep the fallback list */
      }
      if (cancelled) return;
      dbsRef.current = list;
      setDbs(list);

      // 2) Fetch the saved selection.
      let savedKey: string | null = null;
      try {
        const res = await fetch("/api/user/settings", { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          const prefs = (data?.preferences ?? {}) as Record<string, unknown>;
          prefsRef.current = prefs;
          if (typeof prefs.cmfLoadDbKey === "string") savedKey = prefs.cmfLoadDbKey;
        }
      } catch {
        /* best-effort — keep default */
      }
      if (cancelled) return;

      // 3) Active = saved key if still granted, else the first granted DB, else
      //    "" (no access).
      const valid = new Set(list.map((d) => d.key));
      const next = savedKey && valid.has(savedKey) ? savedKey : list[0]?.key ?? "";
      setActive(next);
      activeRef.current = next;
      try { localStorage.setItem(CMF_ACTIVE_DB_KEY, next); } catch { /* ignore */ }
      onChangeRef.current(selectionFor(next, list));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = useCallback((next: string) => {
    const prev = activeRef.current;
    setActive(next);
    activeRef.current = next;

    // Confirm the switch. This is not decoration: the active database is the
    // target for LOADS as well as exports, so a silent change is the kind that
    // ends with data written to the wrong system. Naming it makes the change
    // visible at the moment it happens.
    //
    // Only on a real change — re-selecting the database already in use is a
    // no-op and should not produce a notification.
    if (prev !== next) {
      const label = dbsRef.current.find((d) => d.key === next)?.label ?? next;
      toast.success(`Switched to ${label}`, {
        description: "Exports read from, and loads write to, this database.",
      });
    }

    try { localStorage.setItem(CMF_ACTIVE_DB_KEY, next); } catch { /* ignore */ }
    const sel = selectionFor(next, dbsRef.current);
    onChangeRef.current(sel);
    const merged = { ...prefsRef.current, cmfDb: sel.cmfDbs, cmfLoadDbKey: next };
    prefsRef.current = merged;
    fetch("/api/user/settings", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ preferences: merged }),
    }).catch(() => {
      /* best-effort persist */
    });
  }, []);

  // Mutually exclusive: turning a database ON makes it the active one; turning
  // the active one OFF is ignored (exactly one must always be active).
  const onToggle = useCallback(
    (key: string, on: boolean) => {
      if (on) apply(key);
      // off on the active one → no-op (switch by enabling the other instead)
    },
    [apply],
  );

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Choose which CMF database to export from and load into"
        aria-label={active ? `CMF database: ${labelFor(active)}. Click to change.` : "No CMF database access"}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <span className={cn("size-2 rounded-full", active ? "bg-sky-500" : "bg-muted-foreground/40")} />
        DB: {active ? labelFor(active) : "None"}
      </button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 w-60 rounded-lg border border-border bg-card p-3 shadow-lg">
            <div className="mb-2 text-xs font-semibold text-foreground">CMF database</div>
            {dbs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No databases are assigned to you. Ask an admin to grant access.
              </p>
            ) : (
              <div className="space-y-2">
                {dbs.map((db) => (
                  <label key={db.key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-foreground">{db.label}</span>
                    <Switch
                      checked={active === db.key}
                      onCheckedChange={(on) => onToggle(db.key, on)}
                      aria-label={`Use ${db.label}`}
                    />
                  </label>
                ))}
              </div>
            )}
            <p className="mt-3 border-t border-border pt-2 text-[10px] leading-snug text-muted-foreground">
              The active database is used for both export and load. To move data
              across, export here, switch, then load.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
