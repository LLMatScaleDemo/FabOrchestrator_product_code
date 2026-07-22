# `lib/cmf/cmf-auth.ts` — the MES write token, fetched and cached from Secrets Manager

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab only** (`claudeai_athena/lib/cmf/cmf-auth.ts`; Admin has no copy — see the
> Both-apps note) · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.3](../01-file-catalog.md) · Hotspot: [03 §1 row 16](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Provides the CMF MES API Bearer token to the rest of the Fab app. The token is a JWT
that a **separate, out-of-repo Lambda** (`cmf-auth-token`) mints every ~45 minutes and
publishes to AWS Secrets Manager; this file is a *read-only consumer* — it fetches the
secret, caches it in process memory, and re-reads only when the cached token nears its
published expiry. Every authenticated call to the CMF MES (including the master-data
**load/commit** in [`cmf-client.ts`](./cmf-client.md)) rides on the token this file
returns, which is why it's hotspot row 16.

## Depends on / consumed by

**Depends on:**
- `@aws-sdk/client-secrets-manager` — `SecretsManagerClient` + `GetSecretValueCommand`.
  The client is constructed with **only a region**; credentials come from the AWS SDK's
  default provider chain (env vars / instance-or-task role / profile). Per the file
  header, the runtime role needs `secretsmanager:GetSecretValue` on
  `arn:aws:secretsmanager:us-west-2:628203515088:secret:cmf/mes-token-*`.
- The external `cmf-auth-token` Lambda (**source not in this repo** — see
  [00 §Phase-0 scope](../00-phase-0-scope-and-inventory.md)), which must keep the secret
  fresh. Expected secret payload: `{ "token": "<jwt>", "expiresAt": <ms epoch> }`.
- Env vars (all optional, defaults in parentheses):
  `CMF_TOKEN_SECRET_ID` (`cmf/mes-token`) — which secret;
  `CMF_TOKEN_REGION`, falling back to `AWS_REGION` (`us-west-2`) — where;
  `TOKEN_SAFETY_MARGIN_SEC` (`60`) — refresh this many seconds before `expiresAt`.

**Consumed by** (verified by import grep at the pinned commit — exactly two callers, both Fab):
- `claudeai_athena/lib/cmf/cmf-client.ts` — `getMesToken()` builds the `Authorization`
  header for all CMF REST calls, i.e. both validate and the real **load/commit**.
- `claudeai_athena/app/api/cmf/packages/route.ts` — `getMesToken()` for the best-effort
  "recent MasterDataPackages" listing (a read).
- `clearMesTokenCache` and `TokenUnavailableError` have **no importers** in app code at
  this commit (the error class is only thrown, and callers catch generically /
  via `cmf-errors.ts`'s classifier).

## Function-by-function

### `getMesToken(): Promise<string>` — the only export that matters

Returns a currently-valid Bearer JWT. Flow:

1. **Cache hit:** if the module-level cache holds a token and
   `Date.now() < expiresAt - MARGIN_MS`, return it — no network at all.
2. **Single-flight:** if another call in *this process* is already fetching, return that
   same in-flight promise (module-level `inflight` variable). All concurrent callers
   share one Secrets Manager round-trip — and share its rejection if it fails.
3. **Fetch:** `GetSecretValue` on the configured secret, parse the JSON payload, and
   validate it (see `readTokenFromSecretsManager` below).
4. **Freshness re-check:** the *fetched* value is checked against the same margin. If the
   published token is already (nearly) expired — i.e. the Lambda has fallen behind — it
   throws `TokenUnavailableError` ("refreshed on a schedule (~45 min); retry shortly")
   and **does not cache** the stale value.
5. On success the entry is cached and the raw JWT string returned. `inflight` is cleared
   in a `finally`, so a failure never wedges the single-flight latch — the next call
   simply retries.

**Expiry source — neither a fixed TTL nor JWT parsing:** the code trusts the
`expiresAt` (ms-epoch) field *stored alongside the token in the secret*, minus the
safety margin. It never decodes the JWT's own `exp` claim. If the Lambda publishes a
wrong `expiresAt`, this module will happily serve an expired token (or refuse a valid
one).

**No retry/backoff:** one attempt per call. Any AWS SDK error (network, throttle,
`AccessDenied`, secret missing) is wrapped in `TokenUnavailableError` and thrown to the
caller. There is no exponential backoff, no stale-token fallback — when Secrets Manager
is unreachable, every CMF operation fails fast with that error until it recovers.

### `readTokenFromSecretsManager(): Promise<TokenCache>` — internal

One `GetSecretValue` call, then three validation gates, each throwing
`TokenUnavailableError` with a distinct message: SDK call failed (message embeds the
secret id, region, and the underlying AWS error text — **not** the token); missing
`SecretString` (e.g. a binary-only secret); not valid JSON; missing `token`/`expiresAt`
(note: falsy check, so `expiresAt: 0` also rejects). `expiresAt` is coerced with
`Number(...)`, so a numeric string works; a non-numeric one becomes `NaN` (see gotchas).

### `TokenUnavailableError extends Error`

Marker class for "no valid token right now". Messages are operator-oriented (mention the
~45-min rotation and IAM) and never contain the token value.

### `clearMesTokenCache(): void`

Test/debug helper: nulls the cache so the next call re-reads the secret. Does *not*
cancel an in-flight fetch. No production callers at this commit.

### Small internals

`sm()` — lazy singleton `SecretsManagerClient({ region })`, created on first use and
never recreated (a region env change requires a process restart). `valid(entry)` — the
margin check used for both the cache and freshly fetched values.

## Failure modes & gotchas

- **Per-process cache under multi-instance deployment** (hotspot row 16's core concern):
  cache and single-flight are module-level variables — scoped to one Node process. With
  N instances (or N Lambda containers, or dev-server worker restarts), each fetches and
  refreshes independently: N× `GetSecretValue` per ~45-min rotation window, and no
  cross-instance dedup. Likely fine at small N given the header's explicit worry about
  per-call cost/rate limits, but worth confirming the expected instance count.
- **Stale-secret hammering:** step 4's "fetched token already expired" path throws
  *without caching anything*, so while the Lambda is behind, **every** `getMesToken`
  call performs a fresh Secrets Manager read (single-flight only collapses concurrent
  callers, not sequential requests). An outage of the minting Lambda turns into a
  Secrets Manager call per CMF-touching request.
- **`TOKEN_SAFETY_MARGIN_SEC` misconfiguration bricks the module:** a non-numeric value
  makes `MARGIN_MS = NaN`; `Date.now() < expiresAt - NaN` is always `false`, so no token
  — cached *or* freshly fetched — ever validates. Every call then throws the misleading
  "published CMF token has expired" error even when the secret is perfectly fresh. No
  guard, no log.
- **Expiry race at the margin edge:** the margin (default 60 s) is checked at *token
  hand-out*, not at use. A long CMF operation (e.g. `cmf-client`'s polling loop, if it
  re-uses one token) can outlive the token; whether callers retry on an MES 401 is
  cmf-client's concern, not handled here.
- **Rotation behavior is cooperative, not evented:** nothing subscribes to secret
  rotation; the new token is picked up lazily when the old one enters the margin window.
  This only works because the JWT lifetime (~50 min per the header) exceeds the rotation
  period (~45 min). If those Lambda-side numbers change, this module's assumptions break
  silently.
- **Token leakage — clean here, caller-dependent elsewhere:** this file never logs the
  token; error messages carry secret id/region/AWS error text only. The raw JWT is
  returned to callers, so any caller that logs its request headers would leak it (none
  found doing so at this commit; `api/cmf/packages` logs only upstream status/body
  slices).
- **Misleading comment — in the *consumer*, not here:** `cmf-client.ts`'s header still
  says it depends on "cmf-auth's Playwright child-process token fetch". There is no
  Playwright anywhere in `cmf-auth.ts` — it is pure AWS SDK. Flagged in
  [03 §6](../03-review-hotspots.md); documentation-only, but confirm no dead Playwright
  path exists elsewhere.
- **No local-dev escape hatch:** there is no mock/env-var override for the token value
  itself — local development of any CMF feature needs live AWS credentials with read
  access to the secret (or a locally created secret plus `CMF_TOKEN_SECRET_ID`).

## Open questions for the code owner

1. How many app instances run in production, and are N independent per-process caches
   acceptable for Secrets Manager rate limits/cost (hotspot row 16)?
2. Is no-cache-on-stale intended, given a minting-Lambda outage degrades to one
   `GetSecretValue` per request with no backoff?
3. Confirm the Lambda's ~45-min rotation, ~50-min JWT validity, and that the published
   `expiresAt` matches the JWT's real `exp`.
4. Should `MARGIN_MS` guard against `NaN` from a bad `TOKEN_SAFETY_MARGIN_SEC`?
5. Does `cmf-client` handle an MES 401 mid-operation, or is the 60-second margin the
   only protection?
6. Can the stale Playwright-token-fetch comment in `cmf-client.ts` be corrected, and is
   that old fetch path fully removed?
7. Where does the `cmf-auth-token` Lambda's source live? (Not in this repo.)

## Both-apps note

**Fab only.** Verified at the pinned commit: no `cmf-auth` file and no
`SecretsManagerClient`/`GetSecretValue`/`getMesToken` references anywhere under
`admin_athena/`. Admin's CMF-related surface (`app/api/admin/cmf-loads/route.ts`,
`data-loader-dashboard.tsx`) reads load *records* from the shared DB and never talks to
the MES, so it needs no token.
