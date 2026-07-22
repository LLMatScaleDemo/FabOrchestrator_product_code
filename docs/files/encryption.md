# `lib/encryption.ts` — secrets encryption, password hashing, token generation

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **both** (`claudeai_athena/lib/encryption.ts` and `admin_athena/lib/encryption.ts`) · Review priority: **High** ·
> Catalog row: [01 — File catalog §A.1 / §B.1](../01-file-catalog.md) · Hotspot: [03 §1 row 2](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

The cryptography toolbox for both apps: encrypts stored secrets (MCP credentials, API
keys) with AES-256-GCM, hashes and verifies user passwords with scrypt, and generates
random session/reset tokens. Every credential the platform stores or checks passes
through this file.

## Depends on / consumed by

**Depends on:**
- Node's built-in `crypto` module only — no third-party crypto.
- Env var **`KEY_ENCRYPTION_SECRET`** — must be exactly 64 hex characters (a 32-byte
  AES-256 key). Read lazily on each encrypt/decrypt call, not at startup.

**Consumed by** (verified by import grep at the pinned commit):
- *Fab (10 files):* `lib/mcp-client.ts` (decrypts MCP credentials at call time), the auth
  routes (`login`, `change-password`, `password-reset`, `password-reset/confirm`), user
  settings/API-key routes (`user/settings`, `user/anthropic`), and the MCP connection
  routes (`mcp/connections` create/test/discover).
- *Admin (7 files):* `services/admin-user-service.ts` and `services/invitation-service.ts`
  (password set/reset, invite tokens), the auth routes (`login`, `password-reset`,
  `password-reset/confirm`), and the `admin/mcp-registry` routes (encrypting registry
  credentials).

## Function-by-function

### `encrypt(plaintext: string): string`

AES-256-GCM encryption. Generates a random 16-byte IV per call, returns
`iv:authTag:ciphertext` (each part hex-encoded). Throws if `KEY_ENCRYPTION_SECRET` is
missing or not 64 hex chars. Side effects: none beyond reading the env var.

### `decrypt(encryptedText: string): string`

Reverse of `encrypt`. Splits on `:` and requires exactly 3 parts, else throws
`Invalid encrypted text format`. Sets the GCM auth tag before finalizing, so a tampered
ciphertext or wrong key throws (authenticated decryption) rather than returning garbage.

### `generateEncryptionKey(): string`

Helper that returns 32 random bytes as 64 hex chars — used by an operator to mint
`KEY_ENCRYPTION_SECRET`. Not called anywhere in app code.

### `hashPassword(password: string): Promise<string>`

scrypt with a random 16-byte salt and 64-byte derived key; resolves to
`saltHex:derivedKeyHex`. **Latent bug:** in the scrypt callback, `if (err) reject(err);`
is not followed by `return`, so on an scrypt error the code continues to
`resolve(...)` — which dereferences the undefined `derivedKey` and throws inside the
callback. The promise still rejects (first settle wins), but the follow-on `TypeError`
is thrown outside any handler — an uncaught exception in the worker callback. Rare
(scrypt errors are unusual) but real. Flagged as the recommended first fix in
[03 §7](../03-review-hotspots.md#7-where-to-start-contributing).

### `verifyPassword(password: string, hash: string): Promise<boolean>`

Splits the stored `salt:key` hash, re-derives with scrypt, compares with
`crypto.timingSafeEqual` (constant-time, resists timing attacks). Same
`reject`-without-`return` bug as `hashPassword`. Additional sharp edges: a malformed
stored hash (no `:`, or odd length) makes `Buffer.from`/`timingSafeEqual` throw rather
than return `false`; `timingSafeEqual` also throws if the stored key isn't exactly
64 bytes.

### `generateToken(length = 32): string`

`crypto.randomBytes(length).toString('hex')` — so the default "32" produces a **64-char**
hex string. Used for session tokens, password-reset tokens, and invitation tokens. This is
the source of the tokens that [`auth-middleware`](./auth-middleware.md) later checks with
its `length >= 32` rule.

## Failure modes & gotchas

- **The scrypt `reject`-without-`return` bug** (both functions, both apps) — see above.
- **Misleading doc comments (Fab copy):** `hashPassword`'s comment says "bcrypt-compatible
  algorithm" and "base64-encoded" — it is scrypt and hex-encoded. Comment-only, but worth
  fixing when the bug fix lands.
- **Key handled as hex string in env** — `KEY_ENCRYPTION_SECRET` validation is length-only
  (`64` chars); a 64-char string containing non-hex characters would silently produce a
  short/garbage key via `Buffer.from(key, 'hex')` rather than erroring.
- **No key rotation support.** Ciphertexts don't carry a key id; rotating
  `KEY_ENCRYPTION_SECRET` orphans every previously encrypted credential.
- **Env read is lazy** — a missing key is only discovered on the first encrypt/decrypt,
  not at boot.

## Open questions for the code owner

1. Confirm the scrypt `reject`-without-`return` bug and approve the one-line fix
   ([03 §7 task 1](../03-review-hotspots.md#7-where-to-start-contributing)).
2. Confirm GCM auth-tag handling is correct end-to-end (16-byte tag, no truncated-tag
   acceptance) (hotspot row 2).
3. Is the absence of key rotation acceptable, or should ciphertexts be versioned?
4. Should `verifyPassword` treat malformed stored hashes as `false` instead of throwing?

## Both-apps note

Functionally identical in both apps; the Fab copy has doc comments (including the two
misleading ones noted above) and the Admin copy is the same code stripped of comments.
Both share the same `KEY_ENCRYPTION_SECRET` env var name — and must share the same
*value*, since MCP-registry credentials encrypted by Admin are decrypted by Fab's
`mcp-client.ts` via the shared database.
