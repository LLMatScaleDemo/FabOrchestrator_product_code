# `lib/email/*` — the Admin email stack (SMTP transport + HTML templates)

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: **Admin** (`admin_athena/lib/email/`) — but Fab ships a *separate, inline* copy of
> the reset-email logic; see the Both-apps note. · Review priority: **High** ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row 23](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance) (also [§6](../03-review-hotspots.md#6-network-posture-secrets-latent-bugs))

This page covers all three files under `admin_athena/lib/email/`:

- **`smtp.ts`** — the Nodemailer transport and the single `sendSmtpEmail` helper.
- **`invitation-template.ts`** — `buildInvitationEmailHtml`, the invite email body.
- **`password-reset-template.ts`** — `buildPasswordResetEmailHtml`, the reset email body.

They are consumed by the account-lifecycle services, which get their own pages:
[`./invitation-service.md`](./invitation-service.md) and
[`./admin-user-service.md`](./admin-user-service.md) (parallel deep-dives — linked, not
duplicated here).

## Purpose

This is the entire outbound-email surface of the Admin app. Nodemailer sends exactly two
kinds of transactional message — an **invitation** ("you've been invited as a `<role>`")
and a **password reset** ("click to choose a new password") — each rendered from a plain
template-literal HTML string. Both messages are delivered to a person *other than* the
admin who triggered them, and both carry a one-time token (in the link) that is itself the
credential to accept the invite or set a new password. That combination — attacker-or-admin
-influenced strings interpolated **unescaped** into HTML that a different person opens, plus
a secret token in the URL — is why row 23 is High priority.

## Depends on / consumed by

**Depends on:**

- `smtp.ts` → `nodemailer`; env vars `SMTP_SERVER`, `SMTP_PORT` (default `587`),
  `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`. No DB, no crypto.
- The two templates depend on **nothing** — pure string builders, no imports.

**Consumed by** (verified by import grep at the pinned commit):

| Consumer | Uses | Email produced |
|---|---|---|
| [`lib/services/invitation-service.ts`](./invitation-service.md) `createInvitation` (L80–92) | `buildInvitationEmailHtml` + `sendSmtpEmail` | invite |
| `invitation-service.ts` `resendInvitation` (L367–378) | same | invite (resend) |
| [`lib/services/admin-user-service.ts`](./admin-user-service.md) force-reset (L299–313, **dynamic `import()`**) | `buildPasswordResetEmailHtml` + `sendSmtpEmail` | reset (admin-initiated) |
| `app/api/auth/password-reset/route.ts` (Admin, L62–73) | `buildPasswordResetEmailHtml` + `sendSmtpEmail` | reset (self-service) |

No other file imports this module. The Fab app does **not** import it at all (it has no
`lib/email/` directory) — see Both-apps note.

## Function-by-function

### `smtp.ts` — module-level constants + `sendSmtpEmail`

At import time the module reads the five `SMTP_*` env vars and builds two exports:

- **`SMTP_FROM`** — `` `LLMatscale.ai <${SMTP_FROM_EMAIL}>` `` if `SMTP_FROM_EMAIL` is set,
  otherwise **`null`**.
- **`smtpTransport`** — a Nodemailer transport **only if all three of** `SMTP_SERVER`,
  `SMTP_USERNAME`, `SMTP_PASSWORD` are set; otherwise **`null`**. Note the transport is
  created **once at module load**, so changing SMTP env at runtime has no effect until
  restart. TLS posture: `secure: SMTP_PORT === 465` — so on the default port **587,
  `secure` is `false`** (opportunistic STARTTLS at best; nothing sets `requireTLS` or any
  `tls` options). Auth is plaintext `user`/`pass` from env.

`sendSmtpEmail({ to, subject, html }): Promise<boolean>`
- **If `smtpTransport` or `SMTP_FROM` is null → returns `false` immediately** (the "silent
  no-op"). It does **not** send, and — importantly — **it logs nothing itself.** (This is a
  precision correction to the hotspot wording; the link logging happens in the *callers*,
  see below.)
- Otherwise `await smtpTransport.sendMail({ from: SMTP_FROM, to, subject, html })` and
  returns `true`.
- **On a send error it does not catch** — a `sendMail` rejection (bad host, auth failure,
  timeout) propagates out to the caller, which is expected to wrap the call in `try/catch`.

**What the callers do with the `false` return (this is where links get logged):**

| Caller | On `!sent` it runs | What lands in the log |
|---|---|---|
| `invitation-service.createInvitation` | `console.log('[DEV] Accept URL:', acceptUrl)` | full invite URL **incl. the accept token** |
| `invitation-service.resendInvitation` | `console.log('[DEV] Accept URL:', acceptUrl)` | full invite URL incl. the new token |
| `admin-user-service` force-reset | `console.log('[DEV] Password reset link:', …?token=<token>)` | full reset URL **incl. the reset token** |
| Admin `password-reset/route.ts` | `console.log('[DEV] Password reset link:', resetUrl)` | full reset URL incl. token |

In every case the operation **still succeeds** — the account is invited / the reset token
is written to the DB — whether or not email was actually sent. The boolean return is
consulted **only** to decide whether to emit the `[DEV]` log line; no caller surfaces
delivery failure to the admin or the end user.

### `invitation-template.ts` — `buildInvitationEmailHtml(params): string`

Params: `{ inviterName: string; roleName: string; acceptUrl: string; expiresInDays: number }`.
Returns a full HTML document built with a template literal. The interpolations:

- `<strong>${inviterName}</strong>` and `<strong>${roleName}</strong>` — the sentence
  "*`<inviterName>`* has invited you to join the platform as a *`<roleName>`*."
- `href="${acceptUrl}"` — the CTA button's link.
- `${expiresInDays}` — numeric, in the footer.

**None of these are HTML-escaped.** The recipient is the **invitee** (a person other than
the admin who set `inviterName`/`roleName`).

### `password-reset-template.ts` — `buildPasswordResetEmailHtml(params): string`

Params: `{ userName: string; resetUrl: string; expiresInMinutes?: number; expiresInDays?: number }`.
Computes `expiryText` (`"<days> days"` if `expiresInDays` set, else `"<minutes> minutes"`,
defaulting to 60). Interpolations:

- `Hi ${userName || 'there'},` — greeting.
- `href="${resetUrl}"` — the CTA button's link.
- `${expiryText}` — derived from numeric params.

**None are HTML-escaped.** Here the recipient is the **owner of `userName`** — i.e. the
person greeted is the same person whose name is interpolated (self-XSS, low severity).

## The core analysis — every interpolated variable, provenance, escaped?

Escaped? is **No** for every field (raw `${…}` in a template literal — there is no
`escapeHtml`/entity-encoding anywhere in these files).

### Invitation email → opened by the INVITEE

| Field | Origin (traced) | User/admin-controlled? | Escaped? | Injection risk |
|---|---|---|---|---|
| `inviterName` | `inviter.name` — the inviting admin's `User.name`, or the literal `'An administrator'` if null (`invitation-service.ts` L81, L368). `User.name` is **self-set free text** — chosen by that user themselves when they accepted their own invite (`acceptInvitation`, `name` param, L215). | **Yes** — admin-set free text | **No** | **Live: stored-HTML injection.** The admin's display name is rendered as raw HTML in every invitee's inbox. |
| `roleName` | `role.name` from the `Role` table (L82, L369). Set by an admin via `role-service.createRole` (`data.name`). | **Yes** — admin-set free text | **No** | **Live: stored-HTML injection**, same class. Also breaks on a benign `&` (e.g. a "Sales & Ops" role renders wrong). |
| `acceptUrl` | `` `${APP_URL}/register?token=${token}` `` (`buildAcceptUrl`, L14–15). `APP_URL` is an env var; `token` is a server-generated hex string from `generateToken()`. | **No** — env + server secret | No (but moot) | **Not user-controlled** → despite being interpolated unescaped, it is **not** a live link-injection vector. See discrepancy note. |
| `expiresInDays` | `INVITATION_EXPIRY_DAYS` constant. | No | No (numeric) | None. |

### Password-reset email → opened by the ACCOUNT OWNER

| Field | Origin (traced) | User/admin-controlled? | Escaped? | Injection risk |
|---|---|---|---|---|
| `userName` | `user.name` of the reset target — self-service uses the requester's own name (Admin route L63), admin-force uses the target user's name (`admin-user-service` L304). `User.name` is self-set free text. | Yes — but it is the **recipient's own** name | **No** | **Self-XSS only.** The person who could inject is the same person who opens the mail — low severity. |
| `resetUrl` | `` `${APP_URL}/reset-password?token=${token}` `` (env + server hex token). | **No** — env + server secret | No (but moot) | Not user-controlled → not a live link-injection vector. |
| `expiresInMinutes` / `expiresInDays` | Numeric constants (`RESET_EXPIRY_MINUTES` / `RESET_EXPIRY_DAYS`). | No | No (numeric) | None. |

**The one live cross-person risk:** the **invitation** email's **`inviterName`** and
**`roleName`** — both admin-controlled free text, both unescaped, both rendered in a
*different* person's inbox. `userName` in the reset email is unescaped too but only reaches
its own owner. The **URLs are not a live vector** — their values are env-derived and the
token is server-generated hex, so nothing user-supplied reaches the `href`.

## Failure modes & gotchas

- **HTML injection, per field (provenance above).** No escaping on any interpolation.
  Practical impact today is bounded by the fact that the injectable fields (`inviterName`,
  `roleName`) are **admin-controlled**, not attacker-from-the-internet — so this is a
  rogue/compromised-admin or a "name contains `<`/`&`/`"`" *rendering-corruption* problem
  more than an open XSS. Email clients also strip `<script>` and most JS, so the realistic
  payloads are markup/style injection, a spoofed body, or a look-alike link placed *next
  to* the real button. Still: unescaped user-influenced text in mail sent to a third party.
- **Reset/invite link leaks into prod logs when SMTP is unset.** If any of
  `SMTP_SERVER`/`SMTP_USERNAME`/`SMTP_PASSWORD`/`SMTP_FROM_EMAIL` is missing,
  `sendSmtpEmail` returns `false` and every caller `console.log`s the **full URL including
  the one-time token** (table above). Those tokens are the credential to accept the invite
  / set a new password. In production (CloudWatch / stdout capture) that is a real
  credential-in-logs exposure — the `[DEV]` prefix is misleading, since nothing gates this
  to a dev environment; it fires purely on "SMTP not configured." The Admin force-reset and
  self-service reset paths log the reset link; the invite paths log the accept link.
- **Send failure is swallowed; the account action still commits.** `sendMail` rejections
  propagate out of `sendSmtpEmail`, but every caller wraps it in `try/catch` and only
  `console.error`s. So an invite row / reset token is created in the DB even when delivery
  fails outright — the invitee/user may never receive it, with no error surfaced. Callers
  check the boolean **only to choose whether to `[DEV]`-log**, never to abort or alert.
- **TLS/auth of the SMTP connection.** `secure` is `true` only for port 465; on the default
  587 it is `false` (opportunistic STARTTLS, not enforced — no `requireTLS`). SMTP
  username/password come from env in plaintext. Confirm the production relay enforces TLS
  on 587, or the mailbox creds + message bodies can transit in cleartext.
- **Transport is built once at module load.** `smtpTransport`/`SMTP_FROM` are evaluated at
  import; SMTP env changes require a process restart to take effect.
- **`SMTP_PORT` parse:** `parseInt(process.env.SMTP_PORT || '587', 10)` — a non-numeric
  value yields `NaN`, `secure` becomes `false`, and the port passed to Nodemailer is `NaN`
  (connection would fail). Minor, but no validation.

## Open questions for the code owner

1. **Escaping.** Should `inviterName`, `roleName`, and `userName` be HTML-escaped before
   interpolation (row 23 / [§6](../03-review-hotspots.md#6-network-posture-secrets-latent-bugs))?
   Even if admins are trusted, `&`/`<`/`"` in a legitimate name or role corrupts the email.
2. **Log leak.** Is it acceptable that, when SMTP is unset in production, invite/reset URLs
   **with their tokens** are written to logs via the `[DEV]` lines? Should these be gated on
   `NODE_ENV !== 'production'`, or removed? ([§6](../03-review-hotspots.md#6-network-posture-secrets-latent-bugs))
3. **Silent delivery failure.** Should a `sendMail` failure be surfaced (to the admin UI,
   or by failing the invite/reset), rather than swallowed with the token already minted?
4. **TLS on 587.** Does the production relay enforce STARTTLS, given `secure:false` and no
   `requireTLS` on the default port?
5. **URL provenance.** Confirm `APP_URL` and the token generator can never be
   attacker-influenced (they aren't at this commit), keeping the `href` interpolations a
   non-issue.

## Both-apps note

This module lives in **Admin only** — there is no `admin_athena`↔`claudeai_athena` shared
copy of these three files, and **Fab has no `lib/email/` directory at all**. But Fab **does**
send one email: its self-service password reset. Instead of importing this module, Fab's
`claudeai_athena/app/api/auth/password-reset/route.ts` **inlines its own** copy of the whole
thing (L57–97): it constructs a Nodemailer transport inline from the same `SMTP_*` env vars,
and builds a **different, hard-coded** HTML string (a simpler layout with a `#D97757`
button vs Admin's `#1a3a2a`). That inline template interpolates `${user.name || 'there'}`
and `${resetUrl}` **also without escaping** — the same class of bug in a second place — and
on the SMTP-unset / error branches it `console.log`s the reset link **including the token**,
identically to Admin. Fab has **no invitation flow**, so there is no Fab counterpart to the
invitation template.

Net: the reset-email logic exists twice (Admin's reusable module + Fab's inline copy) with
divergent markup but the same unescaped-interpolation and log-leak behavior — a drift hazard.
Any fix to escaping or log-gating must be applied to **both** the Admin templates and Fab's
inline route.
