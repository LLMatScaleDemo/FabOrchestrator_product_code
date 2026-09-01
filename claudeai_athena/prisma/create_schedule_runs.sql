-- Audit log of scheduled report-refresh RUNS (one row per schedule fired).
-- The schedule row keeps only the LATEST status; this keeps the history so an
-- admin can see what ran, when, and whether it succeeded or failed.
-- Additive + idempotent.
--
--   psql "$DATABASE_URL" -f claudeai_athena/prisma/create_schedule_runs.sql

CREATE TABLE IF NOT EXISTS "report_schedule_runs" (
  "id"              text PRIMARY KEY,
  "dashboard_id"    text NOT NULL,
  "source_key"      text NOT NULL DEFAULT 'lumentum',
  "ran_at"          timestamptz(6) NOT NULL DEFAULT now(),
  "refreshed_count" integer NOT NULL DEFAULT 0,
  "failed_count"    integer NOT NULL DEFAULT 0,
  "status"          text NOT NULL DEFAULT 'ok',  -- ok | partial | error
  "error"           text
);

CREATE INDEX IF NOT EXISTS report_schedule_runs_ran_at_idx ON "report_schedule_runs" ("ran_at" DESC);
CREATE INDEX IF NOT EXISTS report_schedule_runs_dash_idx ON "report_schedule_runs" ("dashboard_id", "source_key");
