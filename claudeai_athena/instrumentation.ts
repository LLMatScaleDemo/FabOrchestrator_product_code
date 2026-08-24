/**
 * Next.js server-boot hook. Runs once when the Node server starts.
 *
 * Starts the in-app report-refresh scheduler (the Recent Reports auto-refresh).
 * Guarded to the Node.js runtime only — Next also compiles this file for the
 * Edge runtime, which can't run the pg-backed scheduler, so we bail there and
 * only import the (Node-only) runner inside the guard.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startReportScheduler } = await import("./lib/fabinsight/scheduler-runner");
  startReportScheduler();
}
