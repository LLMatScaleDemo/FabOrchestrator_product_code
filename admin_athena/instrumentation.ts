/**
 * Next.js instrumentation hook — runs once on server boot.
 *
 * Intentionally a no-op for now.
 *
 * The 90-day retention sweep (REQ-02) lives in
 * `lib/session-retention-worker.ts` and can be invoked manually from
 * an admin chat tool, an EventBridge → Lambda cron, or a one-shot
 * admin API endpoint. Auto-starting it from instrumentation.ts is
 * blocked because Next.js compiles this file for both the Node.js
 * and Edge runtimes, and the worker imports `pg` (Node-only).
 *
 * Setting up Edge-safe dynamic loading via `eval` is also forbidden
 * by the Edge runtime's "no dynamic code evaluation" rule, which is
 * enforced even on dead-code paths during the static build.
 */

export async function register() {
  // Intentionally empty.
}
