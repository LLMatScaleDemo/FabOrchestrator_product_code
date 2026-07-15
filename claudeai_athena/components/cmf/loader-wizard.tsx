"use client";

import { cmfFetch } from "@/lib/cmf/client-auth";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ShieldCheck,
  Database,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Lightbulb,
  FileSpreadsheet,
} from "lucide-react";
import { StepProgress, type WizardStep } from "@/components/cmf/step-progress";
import { FileDropZone } from "@/components/cmf/file-drop-zone";
import { ObjectTypeSelector } from "@/components/cmf/object-type-selector";
import { ExecutionLogViewer } from "@/components/cmf/execution-log-viewer";
import { PackageMetaCard } from "@/components/cmf/package-meta-card";
import { ResultBadge, StatusBadge } from "@/components/cmf/status-badge";
import { useExecutionRun } from "@/hooks/use-execution-run";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import type { ExecutionLogEntry, ExecutionResult, MasterDataPackage, UserFriendlyObjectType } from "@/lib/cmf/types";
import { cn } from "@/lib/utils";

const STEPS: WizardStep[] = [
  { key: "upload", label: "Upload" },
  { key: "validate", label: "Validate" },
  { key: "select", label: "Select" },
  { key: "load", label: "Load to MES" },
];

/** Sort errors first, warnings next, info last — so blockers float to the top. */
function sevRank(s: string): number {
  return s === "error" ? 0 : s === "warning" ? 1 : 2;
}

/** Tailwind text colour per severity. */
function sevClass(s: string): string {
  if (s === "error") return "text-destructive";
  if (s === "warning") return "text-amber-700 dark:text-amber-300";
  return "text-emerald-700 dark:text-emerald-300";
}

type CheckError = {
  objectType: string;
  row: number | null;
  column: string | null;
  severity: string;
  message: string;
  category?: string;
};
type ErrorExplanation = {
  objectType: string;
  row: number | null;
  column: string | null;
  problem: string;
  expected?: string | null;
  found?: string | null;
  why: string;
  howToFix: string;
  steps?: string[];
};
type ValidationData = {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount?: number;
  errorsByType: Record<string, CheckError[]>;
  explanations?: ErrorExplanation[];
};

export function LoaderWizard({
  initialPackageId,
  resumeDraftId,
}: {
  initialPackageId?: string;
  resumeDraftId?: string;
}) {
  const router = useRouter();
  // Hydrated (re-run from history) jumps straight to Select; a fresh flow starts at Upload.
  const [packageId, setPackageId] = useState<string | null>(initialPackageId ?? null);
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [pkgName, setPkgName] = useState("");
  const [step, setStep] = useState<number>(initialPackageId ? 2 : 0);
  const [maxReachable, setMaxReachable] = useState<number>(initialPackageId ? 2 : 0);
  const [objectTypes, setObjectTypes] = useState<UserFriendlyObjectType[]>([]);
  const [selected, setSelected] = useState<UserFriendlyObjectType[]>([]);
  const [hydrating, setHydrating] = useState(!!initialPackageId || !!resumeDraftId);

  const [validation, setValidation] = useState<ValidationData | null>(null);
  const [validating, setValidating] = useState(false);
  const [registering, setRegistering] = useState(false);
  // CMF's own validation (op=1, no write) — runs after register, before Select.
  const [cmfValidating, setCmfValidating] = useState(false);
  const [cmfErrors, setCmfErrors] = useState<{ name: string; message: string }[] | null>(null);
  const [cmfExplanations, setCmfExplanations] = useState<ErrorExplanation[]>([]);

  const run = useExecutionRun(packageId);
  const { pkg, setPkg, runningOp, submitting, log, result, attempts } = run;

  // Guards: prevent double-invoking the register+CMF-validate sequence, and
  // ensure it auto-starts at most once per staged file.
  const cmfInFlightRef = useRef(false);
  const autoCmfRef = useRef<string | null>(null);

  // Hydrate an existing package (re-run from Recent/summary).
  useEffect(() => {
    if (!initialPackageId) return;
    let cancelled = false;
    run
      .fetchDetail()
      .then((d) => {
        if (cancelled) return;
        setPkg(d.instance);
        setObjectTypes(d.objectTypes);
        setHydrating(false);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error("Couldn't open package", { description: String(e) });
        setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPackageId]);

  // Resume an interrupted (pre-register) flow from Recent: drop the user at the
  // Validate step with the staged file restored. (Registered flows are resumed
  // via /packages/[cmfId], the initialPackageId path above.)
  useEffect(() => {
    if (!resumeDraftId) return;
    let cancelled = false;
    cmfFetch(`/api/cmf/packages/stage/${encodeURIComponent(resumeDraftId)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error?.description ?? `HTTP ${r.status}`);
        return d as { packageName?: string | null; packageCmfId?: string | null; status?: string };
      })
      .then((d) => {
        if (cancelled) return;
        if (d.packageCmfId) {
          // Already registered — send to the package flow (Select step).
          router.replace(`/modeling-agent/loader/${encodeURIComponent(d.packageCmfId)}`);
          return;
        }
        setStagingId(resumeDraftId);
        setPkgName(d.packageName ?? "");
        setStep(1);
        setMaxReachable((m) => Math.max(m, 1));
        setHydrating(false);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error("Couldn't resume this flow", { description: String(e) });
        setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeDraftId]);

  const goto = useCallback((i: number) => setStep((s) => (i <= maxReachable ? i : s)), [maxReachable]);
  const advanceTo = useCallback((i: number) => {
    setStep(i);
    setMaxReachable((m) => Math.max(m, i));
  }, []);

  const runValidate = useCallback(async () => {
    if (!stagingId) return;
    setValidating(true);
    setValidation(null);
    try {
      const res = await cmfFetch(`/api/cmf/packages/stage/${encodeURIComponent(stagingId)}/validate`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as ValidationData & {
        error?: { title?: string; description?: string };
      };
      if (!res.ok) {
        toast.error(data.error?.title ?? "Validation failed", {
          description: data.error?.description ?? `HTTP ${res.status}`,
        });
        return;
      }
      setValidation(data);
      if (data.ok && (data.warningCount ?? 0) === 0) {
        toast.success("Pre-flight check passed");
      } else if (data.ok) {
        toast.info(
          `Pre-flight passed with ${data.warningCount} warning${data.warningCount === 1 ? "" : "s"} — review before continuing`,
        );
      } else {
        toast.error(`Found ${data.errorCount} pre-flight error${data.errorCount === 1 ? "" : "s"}`);
      }
    } catch (err) {
      toast.error("Validation failed", { description: String(err) });
    } finally {
      setValidating(false);
    }
  }, [stagingId]);

  // Auto-run the template check on entering the Validate step.
  useEffect(() => {
    if (step === 1 && stagingId && !validation && !validating) void runValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, stagingId]);

  // After the template check passes: register the file in CMF, then run CMF's
  // OWN validation (PerformMasterDataPackage op=1 — a dry-run that does NOT
  // write). Only advance to Select if CMF validation is clean; otherwise show
  // CMF's errors so the user can fix the file and try again.
  const registerAndValidate = useCallback(async () => {
    if (!stagingId || !validation?.ok) return;
    if (cmfInFlightRef.current) return; // already registering/validating
    cmfInFlightRef.current = true;
    setRegistering(true);
    setCmfErrors(null);
    setCmfExplanations([]);
    let cmfId: string | null = null;
    try {
      // 1) Register (creates the CMF package + uploads the file; no data load).
      const res = await cmfFetch(`/api/cmf/packages/stage/${encodeURIComponent(stagingId)}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: pkgName }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        packageId?: string;
        objectTypes?: UserFriendlyObjectType[];
        error?: { title?: string; description?: string };
      };
      if (!res.ok || !data.packageId) {
        toast.error(data.error?.title ?? "Couldn't register the package", {
          description: data.error?.description ?? `HTTP ${res.status}`,
        });
        return;
      }
      cmfId = data.packageId;
      const types = data.objectTypes ?? [];
      setPackageId(cmfId);
      setObjectTypes(types);

      // No CMF-detectable types → nothing to validate; proceed to Select.
      if (types.length === 0) {
        router.replace(`/modeling-agent/loader/${encodeURIComponent(cmfId)}`);
        advanceTo(2);
        return;
      }

      // 2) Kick off CMF validation (op=1, no write) over all detected types.
      setRegistering(false);
      setCmfValidating(true);
      const vRes = await cmfFetch(`/api/cmf/packages/${encodeURIComponent(cmfId)}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectedTypes: types }),
      });
      if (!vRes.ok && vRes.status !== 202) {
        const vd = (await vRes.json().catch(() => ({}))) as { error?: { description?: string } };
        toast.error("CMF validation couldn't start", {
          description: vd.error?.description ?? `HTTP ${vRes.status}`,
        });
        return;
      }

      // 3) Poll CMF until the run completes (LastExecutionEndDate is set).
      let logEntries: ExecutionLogEntry[] = [];
      let resultCode: number | undefined;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const dRes = await cmfFetch(`/api/cmf/packages/${encodeURIComponent(cmfId)}`, { cache: "no-store" });
        const dd = (await dRes.json().catch(() => ({}))) as { instance?: MasterDataPackage };
        const inst = dd.instance;
        if (inst?.LastExecutionEndDate) {
          try {
            logEntries = JSON.parse(inst.LastExecutionLog ?? "[]") as ExecutionLogEntry[];
          } catch {
            logEntries = [];
          }
          resultCode = inst.LastExecutionResult as number | undefined;
          break;
        }
      }

      // 4) Decide: State===3 entries are CMF failures (it stops at the first one).
      const errs = logEntries
        .filter((e) => (e as { State?: number }).State === 3)
        .map((e) => ({
          name: e.Name,
          message:
            (e.Messages ?? []).find((m) => /error/i.test(m)) ??
            (e.Messages ?? []).join(" ") ??
            "Validation failed.",
        }));

      if (resultCode === 0 && errs.length === 0) {
        toast.success("CMF validation passed");
        router.replace(`/modeling-agent/loader/${encodeURIComponent(cmfId)}`);
        advanceTo(2);
      } else if (errs.length > 0) {
        setCmfErrors(errs);
        toast.error(`CMF validation found ${errs.length} error${errs.length === 1 ? "" : "s"}`);
        // Best-effort: enrich CMF's terse messages into exact problem/why/fix.
        try {
          const exRes = await cmfFetch(
            `/api/cmf/packages/${encodeURIComponent(cmfId)}/validate/explain`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                errors: errs.map((e) => ({ objectType: e.name, message: e.message })),
              }),
            },
          );
          const exData = (await exRes.json().catch(() => ({}))) as {
            explanations?: ErrorExplanation[];
          };
          setCmfExplanations(exData.explanations ?? []);
        } catch {
          /* enrichment is best-effort; the raw CMF error is still shown */
        }
      } else {
        toast.error("CMF validation didn't complete", { description: "Please try again." });
      }
    } catch (err) {
      toast.error("CMF validation failed", { description: String(err) });
    } finally {
      setRegistering(false);
      setCmfValidating(false);
      cmfInFlightRef.current = false;
    }
  }, [stagingId, validation, pkgName, router, advanceTo]);

  // Auto-start CMF validation only when our pre-flight is squeaky clean —
  // no errors AND no warnings. Files with warnings need an explicit click
  // so the preparer reviews them first (warnings often surface real intent
  // mismatches: enum strings on Int columns, FK names CMF will resolve,
  // mostly-empty rows that may be intentional, etc.).
  useEffect(() => {
    if (
      step === 1 &&
      validation?.ok &&
      (validation.warningCount ?? 0) === 0 &&
      stagingId &&
      !packageId &&
      autoCmfRef.current !== stagingId
    ) {
      autoCmfRef.current = stagingId;
      void registerAndValidate();
    }
  }, [step, validation, stagingId, packageId, registerAndValidate]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Master DataLoader</h1>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Upload a package, validate it against the template and CMF (no data is written), choose
              object types, then load to the MES.
            </p>
          </div>
          {runningOp != null ? (
            <StatusBadge status="running" label="Loading" code={`POLL-${attempts}`} />
          ) : (
            pkg && <ResultBadge result={result} />
          )}
        </div>
        <StepProgress steps={STEPS} current={step} maxReachable={maxReachable} onStepClick={goto} />
      </header>

      {hydrating ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            {step === 0 && (
              <UploadStep
                onStaged={(id, name) => {
                  setStagingId(id);
                  setPkgName(name);
                  setValidation(null);
                  advanceTo(1);
                }}
              />
            )}

            {step === 1 && (
              <ValidateStep
                loading={validating}
                data={validation}
                onRerun={runValidate}
                onNext={registerAndValidate}
                nextBusy={registering || cmfValidating}
                registering={registering}
                cmfValidating={cmfValidating}
                cmfErrors={cmfErrors}
                cmfExplanations={cmfExplanations}
              />
            )}

            {step === 2 && (
              <div className="flex flex-col gap-5">
                {pkg && <PackageMetaCard pkg={pkg} />}
                <ObjectTypeSelector objectTypes={objectTypes} selected={selected} onChange={setSelected} />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {selected.length === 0
                      ? "Select at least one object type to continue."
                      : `${selected.length} object type${selected.length === 1 ? "" : "s"} selected.`}
                  </p>
                  <Button disabled={selected.length === 0} onClick={() => advanceTo(3)}>
                    Next: Load to MES
                    <ArrowRight data-icon="inline-end" aria-hidden />
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <LoadStep
                busy={runningOp === "load" || submitting}
                done={!runningOp && !submitting && result != null}
                result={result}
                log={log}
                selectedCount={selected.length}
                onRun={() => run.start("load", selected)}
              />
            )}
          </CardContent>
        </Card>
      )}

      {step > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => goto(step - 1)}>
            <ArrowLeft data-icon="inline-start" aria-hidden /> Back
          </Button>
        </div>
      )}
    </div>
  );
}

/** Assistant-enriched, location-pinpointed explanations (used for both our
 * template errors and CMF's validation errors). */
function ExplanationsPanel({
  explanations,
  heading,
}: {
  explanations: ErrorExplanation[];
  heading: string;
}) {
  if (!explanations || explanations.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-primary/25 bg-primary/5">
      <div className="flex items-center gap-2 border-b border-primary/15 px-4 py-2.5 text-sm font-medium text-primary">
        <Lightbulb className="size-4" aria-hidden />
        {heading}
        <span className="font-normal text-muted-foreground">— assistant guidance</span>
      </div>
      <ul className="divide-y divide-primary/10">
        {explanations.map((ex, i) => (
          <li key={i} className="flex flex-col gap-1.5 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono">
                {ex.objectType}
                {ex.row != null ? ` · row ${ex.row}` : ""}
                {ex.column ? ` · ${ex.column}` : ""}
              </Badge>
              <span className="font-medium text-foreground">{ex.problem}</span>
            </div>
            {(ex.expected || ex.found) && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px]">
                {ex.expected && (
                  <span className="text-emerald-700 dark:text-emerald-400">Expected: {ex.expected}</span>
                )}
                {ex.found && <span className="text-destructive">Found: {ex.found}</span>}
              </div>
            )}
            <p className="text-muted-foreground">{ex.why}</p>
            {ex.steps && ex.steps.length > 0 ? (
              <div className="text-foreground">
                <span className="font-medium">How to fix:</span>
                <ol className="ml-4 mt-0.5 list-decimal text-muted-foreground marker:text-muted-foreground/70">
                  {ex.steps.map((s, j) => (
                    <li key={j} className="py-0.5">{s}</li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="text-emerald-700 dark:text-emerald-400">
                <span className="font-medium">Fix:</span> {ex.howToFix}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A compact pass / running / fail row for one of the two validation stages. */
function CheckRow({
  label,
  state,
  okText,
  runningText,
  failText,
}: {
  label: string;
  state: "pending" | "running" | "ok" | "fail";
  okText: string;
  runningText: string;
  failText: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="shrink-0">
        {state === "ok" && <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />}
        {state === "fail" && <XCircle className="size-5 text-destructive" aria-hidden />}
        {state === "running" && <Spinner className="size-5 text-primary" />}
        {state === "pending" && (
          <span className="block size-5 rounded-full border-2 border-dashed border-muted-foreground/40" aria-hidden />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p
          className={cn(
            "text-xs",
            state === "ok" && "text-emerald-700 dark:text-emerald-400",
            state === "fail" && "text-destructive",
            (state === "running" || state === "pending") && "text-muted-foreground",
          )}
        >
          {state === "ok" && okText}
          {state === "fail" && failText}
          {state === "running" && runningText}
          {state === "pending" && "Waiting…"}
        </p>
      </div>
    </div>
  );
}

function ValidateStep({
  loading,
  data,
  onRerun,
  onNext,
  nextBusy,
  registering,
  cmfValidating,
  cmfErrors,
  cmfExplanations,
}: {
  loading: boolean;
  data: ValidationData | null;
  onRerun: () => void;
  onNext: () => void;
  nextBusy: boolean;
  registering: boolean;
  cmfValidating: boolean;
  cmfErrors: { name: string; message: string }[] | null;
  cmfExplanations: ErrorExplanation[];
}) {
  // --- Derived validation state (single source of truth for the gate). ---
  const templateOk = !!data?.ok;
  const hasTemplateErrors = !!data && !data.ok;
  const hasCmfErrors = !!(cmfErrors && cmfErrors.length > 0);
  const hasAnyError = hasTemplateErrors || hasCmfErrors;
  const busy = loading || nextBusy || cmfValidating || registering;
  // Continue is allowed only when BOTH checks are clean and nothing is in flight.
  const canContinue = templateOk && !hasAnyError && !busy;

  const templateState: "pending" | "running" | "ok" | "fail" = loading
    ? "running"
    : !data
      ? "pending"
      : data.ok
        ? "ok"
        : "fail";
  const cmfState: "pending" | "running" | "ok" | "fail" = !templateOk
    ? "pending"
    : cmfValidating || registering
      ? "running"
      : hasCmfErrors
        ? "fail"
        : "pending";

  const warningCount = data?.warningCount ?? 0;
  const blockedReason = hasTemplateErrors
    ? "Fix the template errors below, then re-validate."
    : hasCmfErrors
      ? "CMF rejected the file — fix it and re-upload, then validate again."
      : busy
        ? "Validation is still running…"
        : templateOk && warningCount > 0 && !hasCmfErrors
          ? `Pre-flight passed with ${warningCount} warning${warningCount === 1 ? "" : "s"} — review above, then click Continue to send to CMF.`
          : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-medium">Validation</h2>
          <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
            We run two checks before anything is written: a template check (sheets &amp; columns), then
            CMF&apos;s own dry-run validation. Both must pass to continue.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRerun} disabled={loading || nextBusy}>
          {loading ? <Spinner data-icon="inline-start" /> : <ShieldCheck data-icon="inline-start" aria-hidden />}
          {loading ? "Validating…" : "Re-validate"}
        </Button>
      </div>

      {/* Two-stage check summary */}
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        <CheckRow
          label="1 · Template check"
          state={templateState}
          runningText="Checking sheets and columns…"
          okText="The file matches the master-data template."
          failText={
            data
              ? `${data.errorCount} error${data.errorCount === 1 ? "" : "s"} found — see details below.`
              : "Template errors found."
          }
        />
        <CheckRow
          label="2 · CMF validation (dry-run, no write)"
          state={cmfState}
          runningText="Registering and validating in CMF…"
          okText="CMF accepted the file."
          failText={
            cmfErrors
              ? `${cmfErrors.length} error${cmfErrors.length === 1 ? "" : "s"} reported by CMF.`
              : "CMF reported errors."
          }
        />
      </div>

      {loading && <Skeleton className="h-20 w-full" />}

      {!loading && data && (
        <>
          {hasTemplateErrors && (
            <ExplanationsPanel explanations={data.explanations ?? []} heading="How to fix these errors" />
          )}

          {Object.entries(data.errorsByType).map(([type, errs]) => {
            const errorCount = errs.filter((e) => e.severity === "error").length;
            const warnCount = errs.filter((e) => e.severity === "warning").length;
            const infoCount = errs.filter((e) => e.severity === "info").length;
            const sorted = [...errs].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
            return (
              <div key={type} className="overflow-hidden rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium">
                  {type}
                  {errorCount > 0 && (
                    <Badge variant="destructive">{errorCount} error{errorCount === 1 ? "" : "s"}</Badge>
                  )}
                  {warnCount > 0 && (
                    <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-200">
                      {warnCount} warning{warnCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {infoCount > 0 && (
                    <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-200">
                      {infoCount} note{infoCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
                <ul className="divide-y divide-border text-xs">
                  {sorted.slice(0, 100).map((e, i) => (
                    <li key={i} className="flex gap-3 px-3 py-1.5">
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {e.row != null ? `row ${e.row}` : "sheet"}
                        {e.column ? ` · ${e.column}` : ""}
                      </span>
                      <span className={sevClass(e.severity)}>{e.message}</span>
                    </li>
                  ))}
                  {sorted.length > 100 && (
                    <li className="px-3 py-1.5 text-muted-foreground">… +{sorted.length - 100} more</li>
                  )}
                </ul>
              </div>
            );
          })}

          {templateOk && cmfExplanations.length > 0 && (
            <ExplanationsPanel explanations={cmfExplanations} heading="How to fix the CMF error" />
          )}

          {hasCmfErrors && (
            <Alert variant="destructive">
              <XCircle aria-hidden />
              <AlertTitle>
                CMF validation failed — {cmfErrors!.length} error{cmfErrors!.length === 1 ? "" : "s"}
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <ul className="flex flex-col gap-1.5 text-xs">
                  {cmfErrors!.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono font-medium text-destructive">{e.name}</span>
                      <span className="ml-2 text-foreground">{e.message}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px]">
                  CMF validates one type at a time and stops at the first failure — fix this in the file
                  and re-upload, then validate again. (More may surface after this is resolved.)
                </p>
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          <div className="flex flex-wrap items-center justify-end gap-3">
            {blockedReason && (
              <p className="mr-auto text-xs text-muted-foreground">{blockedReason}</p>
            )}
            <Button disabled={!canContinue} onClick={onNext}>
              {busy && <Spinner data-icon="inline-start" />}
              {cmfValidating
                ? "Validating in CMF…"
                : registering
                  ? "Registering in CMF…"
                  : "Continue to Select"}
              {!busy && <ArrowRight data-icon="inline-end" aria-hidden />}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function UploadStep({
  onStaged,
}: {
  onStaged: (stagingId: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file || !name.trim()) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("name", name.trim());
      const res = await cmfFetch("/api/cmf/packages/stage", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        stagingId?: string;
        error?: { title?: string; description?: string };
      };
      if (!res.ok || !data.stagingId) {
        toast.error(data.error?.title ?? "Upload failed", {
          description: data.error?.description ?? `HTTP ${res.status}`,
        });
        return;
      }
      toast.success("File uploaded — validating against template");
      onStaged(data.stagingId, name.trim());
    } catch (err) {
      toast.error("Upload failed", { description: String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="pkg-name">Package name</Label>
        <Input
          id="pkg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ENT_MasterData_2026Q2"
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">
          A unique, recognisable name. This is how the package appears in CMF and in Recent.
        </p>
      </div>
      <FileDropZone disabled={busy} onFile={(f) => setFile(f)} onClear={() => setFile(null)} />
      <div className="flex justify-end">
        <Button disabled={busy || !file || !name.trim()} onClick={submit}>
          {busy ? <Spinner data-icon="inline-start" /> : <FileSpreadsheet data-icon="inline-start" aria-hidden />}
          {busy ? "Uploading…" : "Upload & validate"}
        </Button>
      </div>
    </div>
  );
}

function LoadStep({
  busy,
  done,
  result,
  log,
  selectedCount,
  onRun,
}: {
  busy: boolean;
  done: boolean;
  result: ExecutionResult | undefined;
  log: ExecutionLogEntry[];
  selectedCount: number;
  onRun: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Alert>
        <Database aria-hidden />
        <AlertTitle>Load to the live MES database</AlertTitle>
        <AlertDescription>
          This writes {selectedCount} object type{selectedCount === 1 ? "" : "s"} to production CMF. This
          action commits data and cannot be undone from here.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {done ? <ResultBadge result={result} /> : <span className="text-sm text-muted-foreground">Ready to load.</span>}
        <Button variant="destructive" disabled={busy} onClick={onRun}>
          {busy ? <Spinner data-icon="inline-start" /> : <Database data-icon="inline-start" aria-hidden />}
          {busy ? "Loading…" : "Load to MES"}
        </Button>
      </div>
      {(log.length > 0 || done) && (
        <>
          <Separator />
          <ExecutionLogViewer entries={log} />
        </>
      )}
    </div>
  );
}
