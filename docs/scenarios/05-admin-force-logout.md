# Scenario 05 — Admin Forces a User to Log Out

> Version: commit `abe8706` on `main` (re-verified 2026-07-22; originally traced at `7976c78`). See [README](../README.md).
> **Validation: 🔵 Static** — traced from the route + service + session-audit code. §1's
> dual-path claim was corrected after a static check (see the §1 correction box).

This scenario shows the admin app's defining pattern: **the audit record is written inside
the same database transaction as the change.**

> **Correction (verified at `abe8706`, 2026-07-22):** an earlier draft claimed the admin AI
> chat could also trigger force-logout via the **same** `forceLogoutUser` service function.
> That is **wrong** — `admin_athena/lib/admin-tools.ts` exposes **no force-logout tool**.
> Force-logout is **REST-route-only**. (Other admin-chat tools such as suspend/delete *do*
> evict sessions, but through different service calls, not `forceLogoutUser`.) See
> [tracker discrepancy #18](../07-signoff-tracker.md#76-doc-vs-code-discrepancies-found-by-the-file-deep-dives).

---

## 1. Entry point — one route, one service function

| Path | Entry | File | Calls |
|------|-------|------|-------|
| REST | `POST /api/admin/users/[id]/force-logout` | `admin_athena/app/api/admin/users/[id]/force-logout/route.ts` | `forceLogoutUser(id, adminId, ip)` |

The route calls **`forceLogoutUser`** in `lib/services/admin-user-service.ts`. There is **no
admin-AI-chat path** to this function (confirmed statically: no `force.?logout` tool in
`admin-tools.ts`).

---

## 2. Control flow

```
POST /api/admin/users/[id]/force-logout            [force-logout/route.ts]
│
├─[1] requireAdmin(req)                             [lib/auth-middleware.ts]
│      • not a valid session → 401   • not isAdmin / not ACTIVE → 403
│      → { user } (the acting admin)
│
├─[2] id = params.id  (target user)
│
├─[3] forceLogoutUser(id, auth.user.id, getIpAddress(req))   [lib/services/admin-user-service.ts]
│      │
│      ├─[3a] closeAllUserSessions({userId:id, status:'CLOSED_ADMIN', reason:'admin_force'})  [lib/session-audit.ts]
│      │        → raw SQL UPDATE user_session_logs
│      │             SET session_status='CLOSED_ADMIN', logout_time=NOW(), closed_reason='admin_force'
│      │           WHERE user_id=$1 AND session_status='ACTIVE'         ← DB WRITE (REQ-02 close)
│      │        (run OUTSIDE the tx because it's raw SQL; .catch(()=>0) so a failure doesn't block)
│      │
│      └─[3b] prisma.$transaction(tx =>                                 ← ATOMIC
│               • tx.session.deleteMany({ where:{ userId:id } })        ← DB WRITE (kills live sessions)
│               • recordAuditLog(tx, { action:'user.force_logout',
│                     targetType:'User', targetId:id,
│                     metadata:{ sessionsDeleted, sessionLogsClosed }, ipAddress })  ← DB WRITE (audit, SAME tx)
│               return { sessionsDeleted, sessionLogsClosed }
│            )
│
└─[4] 200 { success:true, sessionsDeleted, sessionLogsClosed }   |  catch → 500 "Failed to force logout"
```

**Effect on the target user:** their `sessions` rows are deleted, so their next authenticated
request fails `validateSession` → **401** and they are logged out. Their audit trail shows
`CLOSED_ADMIN`.

---

## 3. Branch / error matrix

| Condition | Response |
|-----------|----------|
| No/invalid admin session | 401 |
| Valid session but not `isAdmin` / not `ACTIVE` | 403 |
| Target user has no active sessions | 200 (`sessionsDeleted: 0`) — idempotent |
| `closeAllUserSessions` raw SQL fails | swallowed (`.catch(()=>0)`); deletion + audit still proceed |
| DB error in the transaction | 500; transaction rolls back (no partial delete, no orphan audit) |

## 4. Security & data-flow notes

- **Who can call it:** admins only (`requireAdmin` enforces `isAdmin` + `status==='ACTIVE'`).
- **Audit is transactional:** the `audit_logs` row and the session deletion commit together —
  you cannot delete sessions without recording who did it (or vice versa).
- **REQ-02 completeness:** the session-audit rows are closed as `CLOSED_ADMIN` *before* the live
  sessions are deleted, so the audit reason is accurate.
- **No data leaves the system;** everything is local DB writes.

> ⚠️ **Reviewer checks (from [hotspots](../03-review-hotspots.md)):**
> - `closeAllUserSessions` targets by `user_id` (Prisma-safe here). The related
>   `reconcileStaleActiveSessions` path matches by `sha256(token)` and filters `is_admin=false`
>   — confirm an admin can't be force-logged-out through that path.
> - There is **no chat-tool path** to force-logout (see the §1 correction). The suspend/delete
>   chat tools that *do* evict sessions should be checked separately for their own audit coverage.

## 5. Mermaid sequence diagram

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    participant R as force-logout route
    participant S as forceLogoutUser (service)
    participant SA as session-audit (raw SQL)
    participant DB as PostgreSQL

    A->>R: POST /api/admin/users/[id]/force-logout
    R->>R: requireAdmin (401/403 gate)
    R->>S: forceLogoutUser(targetId, adminId, ip)
    S->>SA: closeAllUserSessions(CLOSED_ADMIN)
    SA->>DB: UPDATE user_session_logs (ACTIVE -> CLOSED_ADMIN)
    S->>DB: BEGIN tx
    S->>DB: session.deleteMany(userId=target)
    S->>DB: recordAuditLog(user.force_logout)  [same tx]
    S->>DB: COMMIT
    S-->>R: { sessionsDeleted, sessionLogsClosed }
    R-->>A: 200 success
    Note over DB: target user's next request -> 401 (session gone)
```

## 6. Open validation items

- [x] ✅ **Resolved (static, `abe8706`):** there is no admin-chat force-logout tool — force-logout is REST-only. §1 corrected.
- [ ] Verify a self-targeted force-logout cannot lock the admin out of the console (no self/last-admin guard exists in the service).
- [ ] Verify the target user receives 401 on their next request.
