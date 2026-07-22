# 10a — Scenario Test Plan: Results Log

> Companion to [10 — Scenario Runtime Test Plan](./10-scenario-test-plan.md). Records
> outcomes as tests are run. Version: code at `abe8706`.
>
> **Two columns of truth.** Each test has a *static* part (claims checkable by reading
> code — route paths, function shapes, verbatim strings, table/column existence) and a
> *runtime* part (behavior only a running system settles — rows actually written, LLM
> tool choice, `op=0` commits, caching). This log fills the **static** column now; the
> **runtime** column is BLOCKED until the tests run against a live deployment.

## Environment note (2026-07-22)

The runtime tests **cannot be executed from the documentation workspace**: no `.env`
(only `.env.example`), so no `DATABASE_URL`, Anthropic key, or CMF/MES secrets; the apps
are not running; no `psql`; no VPN. A live deployment with the shared PostgreSQL + AWS
Secrets Manager + Anthropic API (and VPN + CMF owner for scenario 04) is required. What
follows is the **static pre-flight**: it catches documentation errors before a live run,
but cannot confirm runtime behavior.

Legend: **PASS-static** = code matches the doc claim · **FAIL-static** = code contradicts
the doc · **BLOCKED-runtime** = needs the live environment · **N/A** = not statically
checkable.

---

## Scenario 01 — Login  →  static portion PASSES

Verified by reading `claudeai_athena/app/api/auth/login/route.ts`,
`admin_athena/app/api/auth/login/route.ts`, `admin_athena/lib/validation.ts`, and
`admin_athena/prisma/schema.prisma`.

| Test | Static result | Evidence | Runtime still needed |
|------|---------------|----------|----------------------|
| T1.1 Fab happy path | PASS-static | Order in route: `createSession` → `updateUser(lastLogin)` → `recordLogin` (fire-forget) → `auditLog.create` (fire-forget) → `200 {user,token,expiresAt}`; matches §2 exactly | Rows actually written to `sessions`/`user_session_logs`/`audit_logs` |
| T1.2 Admin happy path | PASS-static | `session.create` → `recordLogin` → `user.update` + `auditLog.create`; body includes `isAdmin`, `role` (route lines 95–105); matches §3 | Same 3 writes |
| T1.3 Fab enumeration | PASS-static | Verbatim `"No account found with this email. Please contact your administrator."`, status 401 (lines 22–25) | That the message actually reaches the user unchanged |
| T1.4 Admin generic | PASS-static | Both no-user (line 30) and bad-password (line 39) return verbatim `"Invalid email or password"`, 401 — indistinguishable | — |
| T1.5 Fab wrong password | PASS-static | `"Incorrect password. Please try again or use \"Forgot password?\" to reset."`, 401 (lines 47–50); status check precedes password check | No session row written |
| T1.6 Admin rejects non-admin | PASS-static | `!user.isAdmin` → 403 `"Admin access required. This portal is for administrators only."` (lines 45–49), *after* password verify | — |
| T1.7 SUSPENDED blocked | PASS-static | Fab: `status==='SUSPENDED'` → 403 (lines 37–41). Admin: `status!=='ACTIVE'` → 403 (lines 53–57) | — |
| T1.8 Zod vs manual | PASS-static (refined) | Admin `LoginSchema` = `email.email('Invalid email format').max(255)` + `password.min(1)` — so **email format + max-255 enforced, password only non-empty** (not min-8). Fab has only `!email\|\|!password`, no format check | Confirm Fab lets a malformed email through to 401 while Admin 400s |

**Table existence:** `sessions` ✅ (`@@map("sessions")`), `audit_logs` ✅
(`@@map("audit_logs")`), `users` ✅. **`user_session_logs` has NO DDL in the repo** —
the known [tracker discrepancy #21](./07-signoff-tracker.md) gap. The T1.1/T1.2 query
against it only returns rows if that table was hand-created in the live RDS; note this
when running.

**Scenario 01 verdict:** every statically-checkable claim is accurate. Badge stays 🔵
until the row-writes and the enumeration behavior are confirmed on a live run.

---

## Scenario 05 — Admin force-logout  →  §2 PASSES, §1 FAILS (predicted)

Verified by reading `admin_athena/app/api/admin/users/[id]/force-logout/route.ts`,
`admin_athena/lib/services/admin-user-service.ts`, `admin_athena/lib/admin-tools.ts`.

| Test | Static result | Evidence | Runtime still needed |
|------|---------------|----------|----------------------|
| T5.1 REST path + transactional audit | PASS-static | `forceLogoutUser` (service line 325) runs `session.deleteMany({where:{userId}})` + `recordAuditLog(tx,…)` inside one `prisma.$transaction`; matches §2 | Target's next request → 401; row values |
| T5.2 Chat-path claim | **FAIL-static** | `admin-tools.ts` exposes **no force-logout tool** (grep: no `force.?logout` match). Scenario 05 **§1** and the entry-point table are **wrong** — the AI chat cannot force-logout. Confirms [tracker discrepancy #18](./07-signoff-tracker.md) | What the AI actually does when asked (likely suspend/delete, which evict sessions via other calls) |
| T5.3 Self-target | N/A (static) | No last-admin/self guard exists in the service (consistent with the deep-dive) — but the *effect* is a runtime question | Whether acting admin logs themselves out |
| T5.4 Idempotency | PASS-static | `deleteMany` on zero rows returns `count:0`; no error path | `200 {sessionsDeleted:0}` |

**Scenario 05 verdict:** the REST path and the transactional-audit pattern (§2, the
scenario's whole point) are accurate. **§1's dual-entry claim is a documentation error** —
correct scenario 05 §1 and its entry-point table to say force-logout is REST-route-only.
Not corrected here (recording as a finding first, per the plan's own rule).

---

## Scenarios 02, 03, 04 — static pre-flight status

- **CMF-area claims (02 tools, 03 MCP client, 04 load path)** were already re-verified
  against `abe8706` during the merge-impact pass and folded into the docs (see the re-pin
  note in the [README](./README.md)). Route paths, function names, the inverted-op-code
  constants, and the `loadToCmf`-excluded-from-belt guard all confirmed statically then.
- **Everything these three scenarios actually test is runtime** — LLM tool selection,
  streaming, prompt-cache hits, per-step cost attribution, the live `op=0` commit, MCP
  session refresh. Those are **BLOCKED-runtime** and are the real reason to run the plan on
  a live system.

---

## Roll-up

| Scenario | Static pre-flight | Blocking finding | Ready to mark 🟢? |
|----------|-------------------|------------------|-------------------|
| 01 Login | ✅ all pass | — | after live row-write + enumeration check |
| 02 Chat turn | ✅ (claims exist) | — | needs full runtime run |
| 03 MCP call | ✅ (claims exist) | — | needs runtime + real MCP server |
| 04 CMF load | ✅ (claims exist) | — | needs VPN + CMF owner (tiered) |
| 05 Force-logout | ⚠️ §2 pass, **§1 fail** | Chat has no force-logout tool | fix §1, then live-run T5.1/T5.3 |

**Documentation fix applied (2026-07-22):** scenario 05 §1, its entry-point table, the §4
reviewer check, and the §6 validation item were corrected — force-logout is REST-route-only;
the admin AI chat has no force-logout tool. Everything else awaits a live environment.
