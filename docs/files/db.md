# `lib/db.ts` — the shared database connection

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **both** (`claudeai_athena/lib/db.ts` and `admin_athena/lib/db.ts`) · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.1 / §B.1](../01-file-catalog.md) · Hotspot: [03 §1 row 1](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Creates the one Prisma database client each app uses for every database operation. It is
the single point where the app connects to the shared PostgreSQL database — so its two
configuration choices (connection string source, TLS off) apply to **all** database traffic
in both apps. The file is only 28 lines; its importance comes entirely from what depends on it.

## Depends on / consumed by

**Depends on:**
- `pg` (`Pool`) — the raw PostgreSQL connection pool.
- `@prisma/adapter-pg` (`PrismaPg`) — adapter that lets Prisma drive that pool.
- `./generated/prisma/client` — the generated Prisma client (from `prisma/schema.prisma`).
- Env var **`DATABASE_URL`** — the full connection string (host, credentials, database name).

**Consumed by:** 54 files across both apps (verified by import grep at the pinned commit) —
every `lib/` module that touches the DB (`storage.ts`, `session-audit.ts`, `prompt-audit.ts`,
`errors/error-audit.ts`, `model-registry.ts`, `repo-cmf/*`, admin `services/*`,
`admin-tools.ts`) and every API route that queries Prisma directly. If it's a DB read or
write anywhere in either app, it goes through this file.

## Function-by-function

There are no functions — the file exports a single value.

### `prisma` (also the default export)

A `PrismaClient` singleton wired to a `pg` `Pool`:

1. **Pool creation (module load):** `new Pool({ connectionString: process.env.DATABASE_URL, ssl: false })`.
   The pool is configured the moment the module is first imported. `ssl: false` disables
   TLS to the database — the in-code comment says this is deliberate "POC mode" for both
   local and AWS RDS.
2. **Singleton guard:** the client is cached on `globalThis` **only when
   `NODE_ENV !== 'production'`**. This is the standard Next.js pattern to survive
   dev-server hot reloads without leaking connections; in production the module-level
   instance is naturally created once per process.

Side effects: initializes a DB connection pool at import time. No error handling of its
own — a bad `DATABASE_URL` surfaces later, as connection errors on first query.

## Failure modes & gotchas

- **`ssl: false` means unencrypted traffic to RDS** — credentials and data cross the
  network in plaintext (within the VPC).
- **No connection validation at startup.** If `DATABASE_URL` is unset or wrong, the app
  boots fine and fails on the first query — errors show up far from the cause.
- **Two identical files, one database.** Both apps point at the *same* PostgreSQL database
  (this is the entire Fab↔Admin integration mechanism — see
  [04 — Architecture](../04-architecture-and-integration.md)). A config divergence between
  the two copies (e.g. one app getting TLS enabled, or a different pool size) would be
  easy to miss; today they are effectively identical.
- **No pool tuning.** Pool size, idle timeout, and statement timeout are all `pg` defaults.

## Open questions for the code owner

1. Is `ssl: false` to RDS acceptable in production, or a POC leftover?
   (= [blocking question #2](../07-signoff-tracker.md#75-blocking-questions-must-be-answered-to-progress)
   in the sign-off tracker.)
2. Are the `pg` pool defaults (size, timeouts) adequate for production load, and should
   the two apps' pool settings be allowed to diverge?

## Both-apps note

The two copies are line-for-line identical except for one blank line
(`claudeai_athena/lib/db.ts` is 29 lines, `admin_athena/lib/db.ts` is 28). Same pool
config, same singleton pattern, same `ssl: false`.
