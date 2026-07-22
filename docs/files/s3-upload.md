# `lib/s3-upload.ts` — chat attachments into private S3, out as presigned URLs

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Fab only** (`claudeai_athena/lib/s3-upload.ts`; verified — no copy and no
> `@aws-sdk/client-s3` usage anywhere in `admin_athena`) · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 12](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

Stores every file a user attaches in Fab chat into the private S3 bucket
`faborch-user-uploads` and returns a **time-limited presigned GET URL** — a bearer
capability that lets *any* holder (the model, the browser, an external MCP server) fetch
the private object over HTTPS until the URL expires. The bucket needs no public-read
policy; the URL *is* the access grant. Not to be confused with
[`lib/cmf/s3-object.ts`](../01-file-catalog.md), a **separate** S3 module that stores CMF
master-data spreadsheets in a different bucket (`S3_BUCKET`) with its own put/get/delete
API — the two share nothing but the AWS SDK.

## Depends on / consumed by

**Depends on:**
- `@aws-sdk/client-s3` (`S3Client`, `PutObjectCommand`, `GetObjectCommand`) and
  `@aws-sdk/s3-request-presigner` (`getSignedUrl`); `crypto.randomUUID`; `lib/logger.ts`.
- Env vars: `AWS_REGION` (default `us-west-2`), `S3_UPLOAD_BUCKET` (default
  `faborch-user-uploads`), `S3_PRESIGN_TTL_SECONDS` (default **86 400 s = 24 h**, capped
  at the SigV4 maximum **604 800 s = 7 days** — see gotchas: no lower bound).
- Credentials from the default AWS provider chain — header comment says env keys locally,
  the EC2 instance role on Elastic Beanstalk (needs `s3:PutObject`; presigned GETs also
  require the signer to hold `s3:GetObject`).

**Consumed by** (verified by import grep at the pinned commit): **exactly one file** —
[`app/api/chat/route.ts`](./chat-route.md) imports `uploadUserFileToS3` and `presignKey`.
No other imports in either app.

## Function-by-function

### `uploadUserFileToS3({ dataUrl, filename, mediaType?, userId, conversationId? }): Promise<UploadedFileRef | null>`

Uploads one attachment (carried as a base64 `data:` URL) and returns
`{ filename, mediaType, key, url, sizeBytes }`:

1. **Parse:** private `parseDataUrl` regex-splits `data:<mime>;base64,<payload>`. Not a
   data URL → `logger.warn` + **return `null`** (not an error).
2. **Key:** `uploads/{userId}/{conversationId || 'no-conversation'}/{Date.now()}-{randomUUID()}-{safeName}`
   where `safeName` is the filename with anything outside `[a-zA-Z0-9._-]` replaced by
   `_`, truncated to 200 chars (private `sanitizeFilename`). The UUID makes collisions
   moot; the prefix makes keys enumerable per user/conversation.
3. **PutObject:** `ContentType` = caller's `mediaType` → data-URL mime →
   `application/octet-stream` (i.e. **client-controlled**);
   `ContentDisposition: inline; filename="<safeName>"`; S3 object `Metadata` carries
   `user-id`, `original-filename`, and `conversation-id` (when present). No size limit,
   no type allowlist.
4. **Presign:** signs a GET for the new key with `expiresIn: PRESIGN_TTL_SECONDS`, then
   `logger.info` — note the log line puts the TTL in the **`durationMs`** field and the
   S3 key in `route` (both misleading names when reading logs).

**On error:** throws on any S3/credential failure (per its doc comment, "callers should
catch") — the chat route wraps the calls in `Promise.allSettled`, so an upload failure is
logged and the chat turn continues without that file.

### `presignKey(key): Promise<string>`

Generates a **fresh** presigned GET URL for an object already in the bucket. The chat
route calls it every turn for every S3 key recorded in the conversation's message
metadata, so the model always sees live URLs even though earlier ones have expired —
objects are durable, URLs are not. Signing is local (no S3 round trip), but the call
still **throws** if credential resolution fails — and the chat route awaits these via
plain `Promise.all` (see gotchas).

### `UploadedFileRef` (interface) and module plumbing

`{ filename, mediaType, key, url, sizeBytes }` — `key` is the durable handle the chat
route persists; `url` is the perishable capability. `getS3Client()` is a lazily-created
module-singleton `S3Client`; `PRESIGN_TTL_SECONDS` is
`Math.min(Number(env) || 86400, 604800)`.

## Failure modes & gotchas

- **A presigned URL is a bearer capability.** Anyone holding it can fetch the private
  file until expiry — no session, no auth header. Everything below is about where these
  URLs go, verified by grep at the pinned commit:
  - **Egressed to the Anthropic API** — every turn, [`chat-route`](./chat-route.md)
    presigns every S3 key in the conversation and `buildSystemPromptWithTools`
    (`lib/system-prompts.ts`) embeds them in an `<uploaded-files>` section of the system
    prompt, which explicitly instructs the model to pass the exact URL **verbatim** to
    any MCP tool with a file/URL argument and to give the user the exact URL on request.
  - **Egressed to external MCP servers** — when the model obeys, the URL rides in the
    tool arguments that [`mcp-client`](./mcp-client.md)'s `executeMcpTool` POSTs
    (`tools/call` JSON-RPC) to the user-configured `serverUrl`; the server then fetches
    the object from S3. `mcp-client` also `console.log`s the full args (`[MCP] Args:`),
    so URLs land in **server stdout logs**.
  - **Egressed to the browser** — tool-call parts (args included) stream to the client,
    and the model may echo the URL in its reply text.
  - **Persisted in `prompt_audit_logs.tool_calls`** — the chat route's success hook
    records every tool call's `input`/`output` into the JSONB column via
    [`prompt-audit`](./prompt-audit.md)'s `buildToolCallsPayload`, so any URL the model
    passed to an MCP tool sits in the audit table long after it expires (expired URLs
    are inert, but they reveal bucket/key/user-id structure). If the model echoed the
    URL, it is also in `llm_response`.
  - **Persisted in message history** — the assistant message's `tool-*` parts (with
    `input`/`output`) are saved to the `Message` table. The *user* message stores only
    the durable `metadata.s3Files` **keys** (`{ key, filename, mediaType }`), not URLs —
    deliberate, since URLs expire.
  - **Nuance vs. the hotspot wording:** `prompt_audit_logs.user_prompt` stores only the
    user's text — the *system* prompt (where URLs are injected) is never stored. So
    "URLs injected into prompt" describes the outbound request to Anthropic, and URLs
    reach the audit table only via `tool_calls`/`llm_response`.
- **TTL "24h–7d" has no enforced floor.** Default 24 h; the 7-day cap is enforced by
  `Math.min`; but `S3_PRESIGN_TTL_SECONDS=60` yields 60-second URLs (and `0`/garbage
  silently falls back to 24 h via `|| 86400`). The real range is "env-chosen, up to 7 d,
  default 24 h".
- **Temporary credentials silently shorten the TTL.** On EB the signer is the EC2
  instance role; per AWS-documented SigV4 behavior a presigned URL dies when the
  temporary credentials that signed it expire, regardless of `expiresIn` — so the
  effective lifetime in deployment may be hours, not 24 h. 🔵 Static/doc-based; needs a
  runtime check.
- **`presignKey` failures can break the chat turn.** Uploads are `allSettled`, but the
  chat route builds `promptFileRefs` with plain `Promise.all(presignKey(...))` — one
  rejection (e.g. credential-chain failure) propagates, contrary to this module's stated
  "a storage hiccup never breaks the chat stream" intent.
- **Client-controlled `ContentType` + `inline` disposition:** a user can upload
  `text/html` and receive a URL that renders inline from the S3 origin. Contained to the
  S3 domain, but worth an allowlist decision.
- **No deletion, no size limit:** nothing in either app deletes from this bucket;
  objects accumulate under `uploads/` forever unless a bucket lifecycle rule exists
  (not visible in this repo's code).
- **Cost side effect:** the chat route disables Anthropic prompt caching whenever file
  refs are present, because the fresh-per-turn URLs would bust the cache prefix.

## Open questions for the code owner

1. Is the presigned-URL flow (URLs handed to MCP servers, persisted in
   `prompt_audit_logs.tool_calls`) the accepted design for private uploads?
   ([03 §1 row 12](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance))
2. What TTL is intended in production — is `S3_PRESIGN_TTL_SECONDS` set anywhere, and do
   URLs actually survive 24 h given the instance role's temporary credentials?
3. Does `faborch-user-uploads` have Block Public Access and a lifecycle/retention rule?
   (Not in `cloudformation/` at the pinned commit.)
4. Should `ContentType` be allowlisted instead of client-trusted, and a max upload size
   enforced?
5. Should the chat route's `presignKey` fan-out use `allSettled` so a credential hiccup
   doesn't fail the turn?

## Both-apps note

**Fab-only — verified.** No `s3-upload.ts`, and no import of `@aws-sdk/client-s3` or
`getSignedUrl`, exists anywhere under `admin_athena` at `7976c78`. Fab's only other S3
code is the unrelated `lib/cmf/s3-object.ts` (CMF master-data files, different bucket
env var, no presigning of user chat uploads).
