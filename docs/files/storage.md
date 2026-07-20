# `lib/storage.ts` — the Prisma CRUD layer under (almost) everything

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab only** (`claudeai_athena/lib/storage.ts`) — Admin has no equivalent file;
> see the Both-apps note. · Review priority: **High** ·
> Catalog row: [01 — File catalog §A](../01-file-catalog.md) · Hotspot:
> [03 §6 — Silent-failure hazards](../03-review-hotspots.md#silent-failure-hazards-swallowed-errors)

## Purpose

The single data-access module for Fab's core tables: users, sessions, conversations,
messages, artifacts, MCP connections, and memory files — thin typed wrappers around the
[`db.ts`](./db.md) Prisma singleton, plus two pure serialization helpers. It is where
[`auth-middleware.ts`](./auth-middleware.md) resolves tokens to users and where every chat
turn is persisted. **It deliberately contains no authorization**: except for the
`userId`-scoped list functions, every by-id accessor trusts its caller to have already
verified ownership (the routes do this by comparing `.userId` — see Failure modes).

No raw SQL and no transactions anywhere in the file — every operation is a single Prisma
call (the raw-SQL session work lives in [`session-audit.ts`](./session-audit.md)).

## Depends on / consumed by

**Depends on:** `lib/db.ts` (`prisma` singleton — so also its `ssl: false` pool and
`DATABASE_URL`), and generated Prisma types (`lib/generated/prisma/client`), which it
re-exports (`User`, `Conversation`, `Message`, `Artifact`, `McpConnection`, `Session`,
`MemoryFile`) — many modules import their DB types from here rather than from Prisma.

**Consumed by** (verified by import grep at the pinned commit): 18 Fab files —
- *Auth:* `lib/auth-middleware.ts` (`getSessionByToken`, dynamic-import `deleteSession`),
  `app/api/auth/{login,logout,change-password}/route.ts`.
- *Chat:* `app/api/chat/route.ts` (`addMessage`, `getMessages`) — see
  [chat-route](./chat-route.md) — and `app/api/modeling-agent/chat/route.ts` (`addMessage`).
- *Conversation CRUD:* `app/api/conversations/route.ts`, `[id]/route.ts`,
  `[id]/messages/route.ts`, `[id]/title/route.ts`, `app/api/messages/feedback/route.ts`.
- *Artifacts:* `app/api/artifacts/route.ts`, `app/api/artifacts/[id]/route.ts`.
- *MCP:* `app/api/mcp/connections/*` routes and `lib/mcp-client.ts`
  (`getMcpConnection`, `updateMcpConnection`).
- *User/memory:* `app/api/user/{settings,anthropic}/route.ts` (`updateUser`),
  `app/api/memory/route.ts`.

Zero imports from `admin_athena/**`.

## Function-by-function

41 exported functions in seven groups, plus the `MessageInput` interface and the 7
re-exported Prisma types. Error-mode legend: **throws** = no try/catch, a Prisma/DB error
propagates to the caller; **null/false** = try/catch swallows *everything* (including
connection failures) and returns the soft value — **without logging**, except where noted.
Reads marked "throws" still return `null`/`[]` for a plain not-found; they only throw on
DB errors.

### Users & sessions (10)

| Export | Behavior | Error mode |
|---|---|---|
| `createUser({email, passwordHash, name?})` | Insert user | throws · **dead code** (no callers; users are provisioned via Admin) |
| `getUserByEmail(email)` | `findUnique` by email | throws / null not-found |
| `getUserById(id)` | `findUnique` by id | throws / null · **dead code** |
| `updateUser(id, data)` | Untyped patch (`Record<string, unknown>` cast into Prisma data) | **throws** — despite the `Promise<User \| null>` signature it has no catch and never returns null (unlike every other `update*`) |
| `deleteUser(id)` | Hard delete; DB cascades wipe sessions/convos/messages/artifacts/MCP/memory | swallow → `false` · **dead code** |
| `createSession({userId, token, expiresAt})` | Insert session — stores the **raw plaintext token** | throws |
| `getSessionByToken(token)` | `findUnique` by token, `include: { user }` | throws / null |
| `deleteSession(token)` | Hard delete by token | swallow → `false` |
| `deleteUserSessions(userId)` | `deleteMany`, returns count | throws · **dead code** (Fab side; Admin force-logout is in Admin) |
| `cleanupExpiredSessions()` | `deleteMany` where `expiresAt < now`, returns count | throws · **dead code** — nothing schedules it ([03 §6 un-scheduled retention](../03-review-hotspots.md)) |

**`getSessionByToken`** is the platform's session lookup: it is step 3 of
[`validateSession`](./auth-middleware.md) on essentially every authenticated request. It
matches the token **verbatim** (no hashing, no expiry filter — expiry and idle checks
happen in the middleware), and the unique index on `sessions.token` is what makes a
64-char random hex token an authentication credential.

**`createSession`** (called only by the login route with `generateToken()` output and a
30-day `expiresAt`) stores the token **in plaintext**. That is load-bearing beyond login:
[`session-audit.ts`](./session-audit.md)'s reconciler deletes stale sessions via
`DELETE ... WHERE encode(sha256(token::bytea),'hex') = ANY($1)` — which only works while
this column stays plaintext. Hash or encrypt the token here and the reconciler silently
stops deleting anything.

**`deleteSession`** is the logout primitive and also how idle eviction ends a session
(auth-middleware dynamic-imports it). Returning `false` instead of throwing means "token
didn't exist" and "DB down" are indistinguishable to callers.

### Conversations (5)

| Export | Behavior | Error mode |
|---|---|---|
| `createConversation({userId, title?, model?, agent?})` | Insert; defaults `'New Chat'` / **`'claude-opus-4-8'`** / `'chat'` | throws |
| `getConversation(id)` | `findFirst` where `deletedAt: null`, includes messages asc | throws / null · **no userId filter** |
| `getAllConversations(userId, agent='chat')` | List non-deleted, pinned-first then `updatedAt` desc | throws · userId-scoped |
| `updateConversation(id, data)` | Untyped patch | swallow → `null` · no userId filter |
| `deleteConversation(id)` | **Soft delete** — sets `deletedAt`; rows for messages/artifacts remain | swallow → `false` · no userId filter |

`deleteConversation` is a soft delete despite the name; the schema's
`onDelete: Cascade` chain (conversation → messages → artifacts) only fires on a *hard*
delete, which nothing in Fab performs (the only hard path is the dead `deleteUser`). No
purge job for soft-deleted conversations was found, so they accumulate — and
`getMessages`/`getConversationArtifacts` do **not** filter on the parent's `deletedAt`,
so a "deleted" conversation's contents remain readable by id.

### Messages (5 + `MessageInput`)

| Export | Behavior | Error mode |
|---|---|---|
| `addMessage(conversationId, {role, content, parts?, metadata?})` | Insert message, then fire-and-forget `lastMessageAt` bump | swallow → `null` (**the only swallow that logs**, `console.error`) |
| `getMessages(conversationId)` | List asc by `createdAt` | throws · **no ownership filter** |
| `clearMessages(conversationId)` | `deleteMany` | swallow → `false` |
| `updateMessage(id, {content?, parts?, metadata?})` | Patch + set `editedAt` | swallow → `null` |
| `deleteMessage(id)` | Hard delete | swallow → `false` · **dead code** |

**`addMessage`** is how every chat turn (user and assistant) is persisted. `parts` — the
AI-SDK part array (text / reasoning / `tool-*` results / step-start) — is stored as raw
JSON in `Message.parts` (`null` if absent); `metadata` (S3 file refs, model id, step
count, reasoning) as JSON defaulting to `{}`. Artifacts are **not** stored here — they go
through `createArtifact` from the artifact routes. Two non-atomic writes: the message
insert, then a **fire-and-forget** `conversation.lastMessageAt` update whose failure is
only console-logged — no transaction, so a message can exist with a stale
`lastMessageAt`. If the insert itself fails (bad `conversationId`, DB outage), the caller
gets `null` — and the chat route **ignores the return value at both call sites**, so a
whole streamed turn can silently fail to persist while the user watches it render.

### Artifacts (5)

| Export | Behavior | Error mode |
|---|---|---|
| `createArtifact({conversationId, messageId, userId, type?='html', title, content})` | Insert | throws |
| `getArtifact(id)` | `findUnique` | throws / null · no userId filter |
| `getConversationArtifacts(conversationId)` | List desc | throws · no ownership filter |
| `updateArtifact(id, {title?, content?})` | Patch | swallow → `null` · no userId filter |
| `deleteArtifact(id)` | Hard delete | swallow → `false` · no userId filter |

### MCP connections (5)

| Export | Behavior | Error mode |
|---|---|---|
| `createMcpConnection({userId, name, serverUrl, authType?='none', authCredentialsEncrypted?})` | Insert (credentials arrive already encrypted by the route) | throws |
| `getMcpConnection(id)` | `findUnique` | throws / null · no userId filter |
| `getUserMcpConnections(userId)` | List desc | throws · userId-scoped |
| `updateMcpConnection(id, data)` | Untyped patch (also used by `mcp-client.ts` to persist refreshed `sessionId`) | swallow → `null` · no userId filter |
| `deleteMcpConnection(id)` | Hard delete | swallow → `false` · no userId filter |

### Memory files (9)

Scope is derived from the path: `/global/...` → `'global'` (shared across **all** users),
anything else → `'user'` (unique per `(userId, path)`).

| Export | Behavior | Error mode |
|---|---|---|
| `getMemoryFile(userId, path)` | User file by `(userId,path)`; global path → `findFirst` by path, **any creator** | throws / null |
| `getUserMemoryFiles(userId)` | User-scope list | throws |
| `getGlobalMemoryFiles()` | All global files | throws |
| `getAllVisibleMemoryFiles(userId)` | User + global union | throws |
| `createMemoryFile({userId, path, content})` | Insert; scope from path | throws |
| `updateMemoryFileContent(userId, path, content)` | Patch; **global path → updates regardless of creator** | swallow → `null` |
| `deleteMemoryFile(userId, path)` | Delete; global path → any user can delete | swallow → `false` |
| `renameMemoryFile(userId, oldPath, newPath)` | Path move; **can flip scope** user↔global | swallow → `false` |
| `deleteAllMemoryFiles(userId, scope?)` | `'user'` → own files; `'global'` → **every user's** global files; omitted → **both** | throws (no catch) |

At the pinned commit, most of this group is latent: the chat route's memory tool that
called `getMemoryFile`/`createMemoryFile`/`updateMemoryFileContent`/`renameMemoryFile`/
`getAllVisibleMemoryFiles` is **commented out** ("Memory tool … (disabled)"). The only
live callers are `/api/memory` GET (`getUserMemoryFiles` + `getGlobalMemoryFiles`) and
DELETE (`deleteMemoryFile`, `deleteAllMemoryFiles`) — meaning nothing currently *writes*
memory files, but any authenticated user can already delete all global ones.

### Pure helpers (2)

| Export | Behavior | Error mode |
|---|---|---|
| `toUIMessage(message)` | DB `Message` → AI-SDK UI shape: no stored parts → single text part; normalizes `reasoning` (`text \|\| reasoning`), `tool-*` (`input \|\| args`, `output ?? result`, default state `'output-available'`), passes unknown part types through | none (pure) |
| `toConversationResponse(conversation)` | API list shape; `lastMessage` = first 100 chars of the final message (whatever its role) | none (pure) |

## Failure modes & gotchas

- **15 mutations swallow errors; only one logs.** All 6 `update*`-style and 9
  `delete/clear/rename` functions wrap Prisma in `try { … } catch { return null/false }`.
  Hotspot [03 §6](../03-review-hotspots.md#silent-failure-hazards-swallowed-errors) asks
  to "verify each swallow actually logs" — statically, **they do not**: only `addMessage`
  `console.error`s; the other 14 are bare `catch {}`. A DB outage looks identical to
  "row not found."
- **Callers are inconsistent about checking the soft values.** The CRUD routes generally
  do (e.g. `conversations/[id]` converts `null`/`false` into
  `FabOrchError.sqlCallFailure`), but the chat and modeling-agent routes `await
  addMessage(...)` and **discard the result** — a failed persist of a chat turn produces
  no error, no retry, and no user-visible signal.
- **Ownership lives in the callers, not here.** Every by-id accessor
  (`getConversation`, `getMessages`, `updateMessage`, `getArtifact`, `getMcpConnection`,
  all `update*`/`delete*`-by-id, …) takes no `userId`. The CRUD routes compensate with a
  fetch-then-compare (`x.userId !== user.id → 403/404`), verified in the artifacts,
  conversations, messages/feedback, and MCP routes. Two gaps found statically:
  1. **`/api/chat` (and `/api/modeling-agent/chat`) never verify the posted
     `conversationId` belongs to the authenticated user** before `addMessage` /
     `getMessages`. Statically that reads as: a valid session could append messages to —
     and pull stored S3 file refs out of — another user's conversation by guessing/knowing
     its cuid. 🔵 Unconfirmed; needs owner/runtime check.
  2. **Global memory files are a shared write/delete surface by design** — any user can
     overwrite, rename (including flipping a file's scope), or bulk-delete every global
     file; `deleteAllMemoryFiles(userId)` with no scope also nukes all globals.
- **`updateUser` breaks the file's own convention** — typed `Promise<User | null>` but it
  throws instead of returning null (no catch). Callers written to the signature
  (`if (!user)`) will never see the null; they'll see an exception.
- **Soft-delete asymmetry.** `deleteConversation` only sets `deletedAt`; list/get filter
  it, but `getMessages`/`getConversationArtifacts` don't, and nothing purges soft-deleted
  rows.
- **Hardcoded default model** `'claude-opus-4-8'` in `createConversation` — a fourth
  model-id source alongside the three flagged in
  [03 §6 duplicated sources of truth](../03-review-hotspots.md).
- **Untyped patch surfaces:** `updateUser` / `updateConversation` /
  `updateMcpConnection` accept `Record<string, unknown>` cast straight into Prisma
  `data` — column allow-listing is the routes' responsibility.
- **Six dead exports** at the pinned commit (`createUser`, `getUserById`, `deleteUser`,
  `deleteUserSessions`, `cleanupExpiredSessions`, `deleteMessage`) plus the five
  memory functions only referenced from the chat route's commented-out memory tool.

## Open questions for the code owner

1. Is the missing conversation-ownership check in `/api/chat` /
   `/api/modeling-agent/chat` a real cross-user write/read hole, or is it mitigated
   somewhere we didn't find (e.g. unguessable cuids being treated as capability tokens)?
2. Should the 14 silent `catch { return null/false }` blocks log (per
   [03 §6](../03-review-hotspots.md#silent-failure-hazards-swallowed-errors))? Today a DB
   outage in any update/delete is invisible outside CloudWatch — and invisible even
   *there* for these paths.
3. Is it acceptable that the chat route ignores `addMessage`'s `null` — i.e. that a
   streamed turn can render for the user but never persist, with only a console line?
4. `sessions.token` plaintext: intentional and load-bearing for the session-audit
   reconciler — confirm no plans to hash it without updating both this file and the
   reconciler ([session-audit](./session-audit.md)).
5. Global memory files: is "any authenticated user can edit/rename/bulk-delete all
   global files" the intended model once the (currently disabled) chat memory tool is
   re-enabled?
6. `updateUser`'s throw-vs-null mismatch: fix the signature or add the catch?
7. Confirm the dead exports (`createUser`, `deleteUser`, `cleanupExpiredSessions`,
   `deleteUserSessions`, `getUserById`, `deleteMessage`) are intentionally kept — and
   whether *anything* is expected to run `cleanupExpiredSessions` (relates to the
   un-scheduled-retention question in 03 §6).
8. Soft-deleted conversations are never purged and their messages remain readable by
   id — intended retention behavior?

## Both-apps note

**Fab-only.** `admin_athena/lib/storage.ts` does not exist (verified by glob and by
grepping Admin's `lib/` and `app/` for storage imports — zero hits), matching the
catalog. Admin instead talks to the same shared DB through `lib/services/*`
(`admin-user-service.ts`, `audit-service.ts`, `invitation-service.ts`,
`role-service.ts`, `usage-service.ts`) and direct Prisma calls (e.g. its
[`auth-middleware`](./auth-middleware.md) queries `prisma.session.findUnique` itself
rather than a `getSessionByToken` helper). So a change to this file affects only Fab —
but a change to what it *writes* (notably the plaintext session token) affects Admin
behavior through the shared tables.

**Sibling pages:** [auth-middleware](./auth-middleware.md) ·
[session-audit](./session-audit.md) · [chat-route](./chat-route.md) · [db](./db.md)
