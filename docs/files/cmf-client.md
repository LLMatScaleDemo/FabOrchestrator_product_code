# `lib/cmf/cmf-client.ts` — the REST client that writes to the live factory MES

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab** (`claudeai_athena/lib/cmf/cmf-client.ts`; Admin has no copy — see the
> Both-apps note) · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 15](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

The typed REST client for CMF (Critical Manufacturing) — the live factory MES, reached
over the VPN. It wraps CMF's six wire-format-sensitive endpoints (file exists/upload,
package create/read, object-type discovery, execute), adds polling, and layers two
orchestrators on top: `prepareMasterData` (upload + discover) and
`queueMasterDataExecution` / `executeMasterData` (run the load or validate). A call
through this file with op `0` **commits master data into the real factory database**
([scenario 04](../scenarios/04-cmf-load.md) traces both end-to-end paths — this page
covers only the client itself). It also carries a **module-load side effect** that
reconfigures TLS and DNS for the *entire process* — see below before anything else.

## ⚠️ Module-load side effects: process-wide TLS + DNS via `setGlobalDispatcher`

At import time — before any function is called — the module installs a custom undici
`Agent` as the **global fetch dispatcher**:

```ts
const CMF_TLS_INSECURE = process.env.CMF_TLS_INSECURE !== "0";
// ...
setGlobalDispatcher(
  new Agent({
    connect: {
      rejectUnauthorized: !CMF_TLS_INSECURE,
      lookup: hostResolverLookup,
    },
  }),
);
```

Three consequences, all 🔵 static reasoning:

1. **Insecure by default.** `CMF_TLS_INSECURE` is treated as insecure for *every* value
   except the exact string `"0"` — unset, `"false"`, `"no"`, `"off"` all leave
   `rejectUnauthorized: false`. Only `CMF_TLS_INSECURE=0` turns certificate verification
   **on**. The in-code comment says this is because the CMF cert is self-signed /
   corp-CA-issued and the host is reached by IP; "for production, install the corp CA
   root and set CMF_TLS_INSECURE=0".
2. **The weakening is process-wide, not CMF-scoped.** `setGlobalDispatcher` (from the
   `undici` npm package) registers the Agent under a well-known global symbol that
   Node's built-in `fetch` also reads — so every `fetch()` in the process that doesn't
   pass its own dispatcher now skips TLS verification: the **Anthropic API** calls, MCP
   connections, and any other outbound HTTPS made via global fetch. (🔵 This is reasoned
   from undici's global-dispatcher mechanism, which the bundled and npm copies share via
   `Symbol.for`; it should be confirmed at runtime, e.g. against a bad-cert test host.)
3. **Custom DNS is also global.** `HOST_RESOLVER` (`"host=ip[,host=ip]"`) is parsed into
   a map, and `hostResolverLookup` short-circuits mapped hostnames (the on-prem CMF host
   is not in public DNS; it's reached by private IP over the VPN). Unmapped hostnames
   fall through to real `dns.lookup`, so this part is benign for other traffic — but it
   is still a global hook on all fetch name resolution.

Note the trigger: **importing anything from this module fires the side effect** —
including `lib/cmf/cmf-errors.ts`, which imports only the `CmfApiError` class.

## Depends on / consumed by

**Depends on:**
- [`cmf-auth.ts`](./cmf-auth.md) — `getMesToken()` (Bearer JWT read from AWS Secrets
  Manager, cached in-memory). **The file's header comment claiming a "Playwright
  child-process token fetch" is stale** — see Failure modes.
- [`lib/cmf/types.ts`](./cmf-types.md) — `CMF_TYPES` `$type` constants, request/response
  shapes, and the **inverted `ExecutionOperation` codes** (`0` = Load/commit, `1` =
  Validate) — hotspot row 14.
- `node:crypto` (SHA-256), `node:dns` + `undici` (the global dispatcher above).
- **Env vars (direct):** `CMF_BASE_URL` (required — `baseUrl()` throws if unset),
  `CMF_TLS_INSECURE` (default **insecure**), `HOST_RESOLVER`. Indirectly via cmf-auth:
  `CMF_TOKEN_SECRET_ID`, `CMF_TOKEN_REGION`/`AWS_REGION`, `TOKEN_SAFETY_MARGIN_SEC`.

**Consumed by** (verified by import grep at the pinned commit — Fab only):
- `app/api/cmf/packages/[id]/load/route.ts` — `getObjectById`,
  `queueMasterDataExecution(id, 0, selectedTypes)` (**commit**).
- `app/api/cmf/packages/[id]/validate/route.ts` — `getObjectById`,
  `queueMasterDataExecution(id, 1, selectedTypes)` (validate).
- `app/api/cmf/packages/[id]/route.ts` — `getObjectById`, `getObjectTypes` (status GET —
  the poll target that drives run reconciliation).
- `app/api/cmf/packages/stage/[id]/register/route.ts` — `prepareMasterData`.
- [`lib/chat-cmf/tools.ts`](./chat-cmf-tools.md) — `loadMasterData(name, file, 0)` from
  the LLM-callable `loadToCmf` tool (**the deprecated function; commit path**).
- `lib/cmf/cmf-errors.ts` — `CmfApiError` only (but importing it still fires the global
  dispatcher side effect).

`executeMasterData`, `pollForCompletion`, `performMDP`, `fileExists`, `uploadFile`,
`createMasterDataPackage`, and `sha256Upper` have **no external importers** at this
commit — they are exercised only through the orchestrators in this file.

## Function-by-function

### Internal plumbing: `baseUrl()` / `authedFetch(path, init)`

Not exported. `baseUrl()` reads `CMF_BASE_URL` (throws if unset, strips trailing
slashes). `authedFetch` is the single choke point for all six calls: awaits
`getMesToken()`, sends `Authorization: Bearer <token>` + `Accept: application/json`,
and on any non-2xx reads the body text (read failure swallowed to `""`) and **throws
`CmfApiError`**. Response bodies are `as`-cast, never runtime-validated.

### `CmfApiError` (class)

Error thrown for every non-2xx. Parses CMF's structured envelope
(`{ Code: { Name, SubCode: { Name } }, Reason: { Text }, Message }`) into
`cmfCode`/`cmfSubCode`/`cmfMessage`; non-JSON bodies leave those `undefined` and the
message falls back to `HTTP <status> <body first 300 chars>`. Carries `path`, `status`,
raw `body`.

### `sha256Upper(bytes): string`

SHA-256 as **uppercase hex** — the checksum format CMF stores and matches on. Pure.

### The six REST calls

Each is a thin typed wrapper over `authedFetch`; all throw `CmfApiError` on non-2xx.
`$type` discriminators come from `CMF_TYPES` in [`types.ts`](./cmf-types.md).

| Fn | Endpoint | Notes |
|---|---|---|
| `fileExists(checksum)` | `POST /api/GenericService/FileExists` | Body `$type: FileExistsInput`; returns `FileExists === true`. |
| `uploadFile(filename, bytes, contentType?)` | `POST /api/GenericService/UploadFile` | Multipart; field name **must be lowercase `file`**; bytes copied into a fresh `ArrayBuffer`; no manual `Content-Type` (boundary set by FormData). Response is **plain text** (the checksum echoed back), not JSON. |
| `createMasterDataPackage(name, file)` | `POST /api/GenericService/CreateObject` | Wraps a `MasterDataPackage` (`Type: "Generic"`) around a `CmfFile`; `Size` is force-coerced to a **string**. Returns `data.Object`. |
| `getObjectById(id)` | `GET /api/GenericService/GetObjectById?Id&Type=MasterDataPackage&LevelsToLoad=1` | Used for verify, fresh-stamp reload before writes, and polling. Returns `data.Instance`. |
| `getObjectTypes(pkg)` | `POST /api/MasterData/GetMasterDataPackageObjectTypes` | Must POST the **full, freshly-fetched** MDP for optimistic-concurrency-stamp parity. Returns `ObjectTypes ?? []`. |
| `performMDP(pkg, op, types)` | `POST /api/MasterData/PerformMasterDataPackage` | **The write.** Passes `ExecutionOperation: op` **unaltered** — in this deployment `0` = Load (**commits**), `1` = Validate ([inverted codes](./cmf-types.md)). `ExecutionConfiguration` is a **JSON-encoded string** of the types array, and `IsToPerformImmediate: true`. Queues and returns immediately. |

### `pollForCompletion(id, opts?): Promise<PollResult>`

Loops `getObjectById` (default **60 attempts × 1000 ms**); done when
`LastExecutionEndDate` is non-null, then returns
`{ result: LastExecutionResult ?? 1, log: JSON.parse(LastExecutionLog ?? "[]"), instance }`.
Throws a plain `Error` on timeout. Two subtleties: a missing `LastExecutionResult`
defaults to `1` (the failure code), and `JSON.parse` of a malformed `LastExecutionLog`
would throw out of the poll loop. A timeout does **not** cancel anything server-side —
the CMF execution may still complete/commit after the client gives up.

### `prepareMasterData(name, file): Promise<PrepareMasterDataResult>`

Phase 1 orchestrator (steps 1–5): `sha256Upper` → `fileExists` → `uploadFile` (only if
new) → `createMasterDataPackage` → fresh `getObjectById` (concurrency stamps) →
`getObjectTypes`. Returns `{ instance, objectTypes, uploaded }`. Deliberately does
**not** call `performMDP` — the user is supposed to pick types first. Any step's
`CmfApiError` propagates.

### `queueMasterDataExecution(packageId, op, selectedTypes)`

Phase 2, fire-and-forget: rejects empty/non-array `selectedTypes` with a plain `Error`,
re-fetches the MDP for fresh stamps, calls `performMDP`, returns
`{ queued: true, packageId, message }` immediately. Callers observe completion by
polling `GET /api/cmf/packages/:id`. This is what both the load (op `0`) and validate
(op `1`) routes use.

### `executeMasterData(packageId, op, selectedTypes, pollOpts?)`

Same as queue but synchronous: after `performMDP` it awaits `pollForCompletion` and
returns the poll result plus the final package. Its own `@remarks` steers new code to
`queueMasterDataExecution`. At this commit its **only caller is `loadMasterData`** below.

### `loadMasterData(name, file, op, pollOpts?)` — `@deprecated` but load-bearing

One-shot wrapper: `prepareMasterData` then
`executeMasterData(id, op, prep.objectTypes, ...)` — i.e. it executes **every detected
object type**, with no user selection step. The doc comment deprecates it in favor of
prepare + execute, "kept only for back-compat with older callers" — yet it is exactly
what the LLM-callable [`loadToCmf` tool](./chat-cmf-tools.md) invokes, with op `0`
(commit). See [03 §4](../03-review-hotspots.md#4-data-integrity--destructive-actions)
and [scenario 04 path (b)](../scenarios/04-cmf-load.md).

## Failure modes & gotchas

- **Process-wide TLS weakening, insecure by default.** The module-load
  `setGlobalDispatcher` sets `rejectUnauthorized: false` unless `CMF_TLS_INSECURE=0` —
  and it applies to **every global-fetch call in the process**, including the Anthropic
  API and MCP traffic, not just CMF ([03 §6](../03-review-hotspots.md#6-network-posture-secrets-latent-bugs)).
  Any truthy-looking value (`"false"`, `"no"`, unset) is still insecure; only the literal
  `"0"` enables verification. And merely importing `CmfApiError` (as `cmf-errors.ts`
  does) is enough to trigger it.
- **Stale header comment.** The file header says it depends on "cmf-auth's Playwright
  child-process token fetch". Verified false at this commit: `cmf-auth.ts` reads the
  token from **AWS Secrets Manager** (`cmf/mes-token`) with an in-memory cache — no
  Playwright, no child process. The only Playwright in the repo is e2e a11y test tooling
  (`playwright.config.ts`, `e2e/landing.a11y.spec.ts` in both apps). Misleading for
  anyone auditing the auth path.
- **Deprecated-but-load-bearing.** `loadMasterData` is `@deprecated` yet is the exact
  function behind the AI `loadToCmf` commit path, and it **auto-runs all detected object
  types**, ignoring the user-selection model the rest of the flow (and the CMF portal)
  uses.
- **Atomic-batch blast radius.** CMF loads are all-or-nothing: one bad row (e.g. a
  missing FK parent) rolls back the entire package — which is why the load-preview
  blocking conflicts must be honored before calling op `0`
  ([03 §4](../03-review-hotspots.md#4-data-integrity--destructive-actions)).
- **Op code passed through raw.** `performMDP` applies no meaning to `op`; the inverted
  semantics (`0` commits) live in callers and [`types.ts`](./cmf-types.md). A caller
  passing the "documented" CMF value would silently do the opposite operation.
- **Poll timeout ≠ no commit.** `pollForCompletion`'s timeout (default ~60 s) only stops
  *watching*; the queued execution can still land in CMF afterwards.
- **No response validation.** All `res.json()` results are `as`-cast; a shape change on
  the CMF side surfaces as downstream `undefined`s, not a clear error. `PollResult`
  defaults a missing `LastExecutionResult` to `1` (failure).
- **`CMF_BASE_URL` is checked lazily** — the module loads (and installs the global
  dispatcher!) fine without it; the first actual call throws.

## Open questions for the code owner

1. Is `CMF_TLS_INSECURE=0` actually set in production with the corp CA installed?
   ([03 §8 Q4](../03-review-hotspots.md#8-open-questions-for-code-owners-consolidated))
2. Is process-wide TLS weakening via `setGlobalDispatcher` acceptable (it also governs
   the Anthropic SDK's fetch), or should the Agent be scoped per-fetch to CMF calls?
3. Is `loadToCmf` riding the `@deprecated` `loadMasterData` (all object types, op `0`)
   intended, or should it migrate to `prepareMasterData` + selected types?
4. Can the stale Playwright header comment be corrected, and is the old Playwright
   token-fetch path confirmed gone?
5. Are the inverted `ExecutionOperation` semantics documented with the CMF vendor, so no
   one "fixes" them? (Hotspot row 14 / [types page](./cmf-types.md).)
6. Can `LastExecutionLog` ever be non-JSON (throwing out of `pollForCompletion`), and is
   `result` defaulting to `1` the right conservative choice?

## Both-apps note

**Fab only.** `admin_athena` has no `lib/cmf/` directory at all (verified by glob at the
pinned commit) — the Admin app never talks to the MES.
