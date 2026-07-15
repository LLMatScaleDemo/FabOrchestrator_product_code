import { prisma } from "@/lib/db";

export type DashboardStats = {
  totalPackages: number;
  totalRuns: number;
  success: number;
  failure: number;
  /** Operational issues (concurrency rejections, timeouts) — not data outcomes. */
  errored: number;
  inFlight: number;
  successRate: number | null;
  recent: {
    id: string;
    operation: "VALIDATE" | "LOAD";
    status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILURE" | "EXPIRED";
    result: number | null;
    startedAt: string;
    packageName: string;
    user: string;
  }[];
};

export async function getDashboardStats(): Promise<DashboardStats> {
  // Success/failure are based on the CMF RESULT code (0 = success, 1 = failure)
  // — i.e. genuine data outcomes. Runs that errored operationally (concurrency
  // rejection → FAILURE with no result, or EXPIRED timeout) are counted as
  // `errored`, NOT as failures, so the success rate reflects real data quality.
  // All Run counts in ONE query (5 conditional aggregates) instead of 5 separate
  // round-trips — meaningful under high DB latency. 3 queries total.
  const [totalPackages, agg, recent] = await Promise.all([
    prisma.package.count(),
    prisma.$queryRaw<
      { total: number; success: number; failure: number; errored: number; inflight: number }[]
    >`
      select
        count(*)::int as total,
        count(*) filter (where result = 0)::int as success,
        count(*) filter (where result = 1)::int as failure,
        count(*) filter (where result is null and status in ('FAILURE','EXPIRED'))::int as errored,
        count(*) filter (where status in ('QUEUED','RUNNING'))::int as inflight
      from "Run"`,
    prisma.run.findMany({
      orderBy: { startedAt: "desc" },
      take: 8,
      include: {
        package: { select: { name: true } },
        user: { select: { email: true } },
      },
    }),
  ]);

  const a = agg[0] ?? { total: 0, success: 0, failure: 0, errored: 0, inflight: 0 };
  const totalRuns = a.total;
  const success = a.success;
  const failure = a.failure;
  const errored = a.errored;
  const inFlight = a.inflight;
  const finished = success + failure;

  return {
    totalPackages,
    totalRuns,
    success,
    failure,
    errored,
    inFlight,
    successRate: finished > 0 ? Math.round((success / finished) * 100) : null,
    recent: recent.map((r) => ({
      id: r.id,
      operation: r.operation,
      status: r.status,
      result: r.result,
      startedAt: r.startedAt.toISOString(),
      packageName: r.package?.name ?? "—",
      user: r.user?.email ?? "—",
    })),
  };
}
