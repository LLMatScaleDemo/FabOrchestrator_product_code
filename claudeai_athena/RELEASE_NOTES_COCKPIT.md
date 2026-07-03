# Cockpit + Sidebar Refresh — Release Notes

Captures the **2026-05-19 cockpit release** to FabOrchestrator.ai, the
previous version to roll back to if needed, and the chat-sidebar dark-blue
theme that is **local-only** at the time of writing.

---

## Currently Deployed

| | |
|---|---|
| **Version label** | `v20260519-181337-cockpit-posix` |
| **Deployed at**   | 2026-05-19 12:43 UTC |
| **EB env**        | `faborchestratorai-prod` (us-west-2) |
| **URL**           | http://faborchestratorai-prod.eba-dk3f4zhh.us-west-2.elasticbeanstalk.com |
| **Status at deploy** | Ready · Green (passed all health checks in ~3.6 min) |

## Previous Version (rollback target)

| | |
|---|---|
| **Version label** | `v20260513-164150-mcpclean` |
| **Deployed at**   | 2026-05-13 |
| **What it contained** | Chat-only baseline — no `/home` route, no static sidebar menus, no role in `/api/auth/me`, no blue cockpit theme. |

### Rollback command

If the cockpit release needs to be reverted, deploy the prior version
(EB keeps it in the application versions list):

```bash
aws elasticbeanstalk update-environment \
  --environment-name faborchestratorai-prod \
  --version-label v20260513-164150-mcpclean \
  --region us-west-2
```

Then poll until `Status=Ready Health=Green`:

```bash
aws elasticbeanstalk describe-environments \
  --environment-names faborchestratorai-prod \
  --region us-west-2 \
  --query 'Environments[0].{Status:Status,Health:Health,Version:VersionLabel}'
```

Rollback duration is the same as a deploy (~3-5 min). The DB schema is
unchanged between these two versions, so a rollback is data-safe.

---

## What Shipped In This Release

### New `/home` cockpit page

A "Cockpit" landing page that sits between login and `/chat`. It contains:

- Top nav: logo + 5 nav links (Cockpit active, others decorative), search /
  notification / app-switcher icon buttons, user pill (name + role).
- Hero: "All Agents Online" pill, gradient headline, subtitle.
- **Ask box**: streams an answer inline from `/api/chat` with `activeMcpIds: []`,
  so it's plain Claude (Sonnet 4.5) with no MCP tools. Conversations are
  **ephemeral** — not persisted to the `Conversation` table.
- 3 suggestion chips below the input (hidden once a message is sent).
- 4 agent cards under "The Nucleus" — every Launch button → `router.push('/chat')`.
- Bottom row: static Live ops counters + Recent activity feed.

### Routing changes

- `app/page.tsx` (login) post-success → `/home` (was `/chat`).
- `app/page.tsx` existing-session restore → `/home` (was `/chat`).
- `app/force-password-change/page.tsx` post-success → `/home` (was `/chat`).
- `/chat` itself is unchanged — still directly reachable.

### API changes

- `app/api/auth/me/route.ts` now includes `role: { id, name } | null` in the
  response. Looked up via a separate `prisma.role.findUnique` from `user.roleId`.
  Backward-compatible — existing fields untouched.

### Chat sidebar — new static menus

Two new `SidebarGroup`s added to `components/full-chat-app.tsx` between the
existing "New chat / Projects" group and the "Pinned" group:

| Group | Items |
|---|---|
| **Workspace** | Dashboard · Agents · Workflows · Reports |
| **Enterprise** | Sites · Integrations · Compliance · Settings |

All items are visual-only (no `onClick` handlers). They use the same
`SidebarMenuButton` primitive as the existing items, so they auto-collapse
to icon-only mode and inherit theme tokens.

### Files added (new)

```
app/home/page.tsx                          — protected /home route
components/cockpit/cockpit-page.tsx        — shell layout
components/cockpit/cockpit-nav.tsx         — top bar
components/cockpit/cockpit-hero.tsx        — hero section
components/cockpit/cockpit-ask.tsx         — streaming Ask box (useChat → /api/chat)
components/cockpit/agent-cards.tsx         — 4 agent cards
components/cockpit/cockpit-footer-stats.tsx — Live ops + Recent activity (static)
```

### Files modified

```
app/api/auth/me/route.ts                   — added role field
components/login-page.tsx                  — redirect /chat → /home (2 places)
app/force-password-change/page.tsx         — redirect /chat → /home
components/full-chat-app.tsx               — static sidebar menus
```

### Database

No schema changes. No migrations to run.

### Notable design decisions

- **No `noMcp` backend flag was needed**: the existing chat route only loads
  MCP tools when `activeMcpIds.length > 0` (`app/api/chat/route.ts:261`).
  Sending `activeMcpIds: []` from the cockpit is sufficient.
- **REQ-04 audit still applies** to cockpit prompts. They are captured in
  `prompt_audit_logs` with empty `tool_calls` and zero `retrieval_*` tokens —
  the correct shape for an MCP-free prompt.
- **Cockpit chats are ephemeral by design**: `conversationId` is not sent, so
  the chat route does not create a `Conversation` row.

---

## Local-only Changes (NOT YET DEPLOYED)

These changes are in the working tree but were intentionally not bundled
into `v20260519-181337-cockpit-posix`. Verify locally first; then re-deploy.

### Chat sidebar — dark navy blue theme

`components/full-chat-app.tsx` — added inline CSS-variable overrides on the
`<Sidebar>` element so the sidebar paints dark navy without touching the
global Claude theme:

```ts
style={{
  "--sidebar": "#0c1844",
  "--sidebar-foreground": "#ffffff",
  "--sidebar-primary": "#60a5fa",
  "--sidebar-primary-foreground": "#ffffff",
  "--sidebar-accent": "#1e3a8a",
  "--sidebar-accent-foreground": "#ffffff",
  "--sidebar-border": "#1e293b",
  "--sidebar-ring": "#60a5fa",
}}
```

Plus an arbitrary-variant on the same element to force idle menu text to
render white (the CVA only declares text color on hover/active, so without
this they inherited the warm Claude foreground):

```
className="border-r [&_[data-sidebar=menu-button]]:text-white"
```

Title retinted: `FabOrchestrator` → `text-white`, `.ai` → `text-sky-400`.

### Chat body background

`components/full-chat-app.tsx` on `<SidebarInset>`:

```
className="overflow-hidden bg-gradient-to-b from-white via-sky-50/40 to-white"
```

Replaces the Claude beige (`#FAF9F5`) with the same white-to-sky-blue tint
the cockpit uses.

### Sidebar scrollbar

`app/globals.css` — added a scoped override after the existing global
scrollbar rules so the sidebar's scrollbar blends with the navy column
instead of showing the OS-default gray bar. Selector targets
`[data-sidebar="content"]` so only the chat sidebar's scroll area is
affected; nothing else in the app changes.

```css
[data-sidebar="content"]::-webkit-scrollbar { width: 6px; height: 6px; }
[data-sidebar="content"]::-webkit-scrollbar-track { background: transparent; }
[data-sidebar="content"]::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
  border-radius: 3px;
}
[data-sidebar="content"]::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
[data-sidebar="content"] {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}
```

### Files modified (local-only)

```
components/full-chat-app.tsx               — sidebar dark theme + chat bg tint
app/globals.css                            — scoped sidebar scrollbar styling
```

---

## Previous Color Details (revert reference)

Snapshot of the colors/styling that were in place **before** the local-only
blue-theme work. Use this section if you decide to back out the dark
sidebar / white-blue chat tint and restore the original Claude theme.

### Original sidebar palette

Lived entirely in `app/globals.css` under `:root` — no inline overrides on
the `<Sidebar>` element. The relevant variables were:

```css
:root {
  --sidebar:                       #F9F8F3;                       /* warm off-white */
  --sidebar-foreground:            oklch(0.3590 0.0051 106.6524); /* warm dark slate */
  --sidebar-primary:               oklch(0.6171 0.1375 39.0427);  /* orange brand */
  --sidebar-primary-foreground:    oklch(0.9881 0 0);             /* near-white */
  --sidebar-accent:                oklch(0.9245 0.0138 92.9892);  /* pale beige (hover bg) */
  --sidebar-accent-foreground:     oklch(0.3250 0 0);             /* dark gray */
  --sidebar-border:                oklch(0.9401 0 0);             /* very light gray line */
  --sidebar-ring:                  oklch(0.7731 0 0);             /* light gray focus ring */
}
```

Dark-mode counterparts in `.dark { … }` further down the same file:

```css
.dark {
  --sidebar:                       #242423;
  --sidebar-foreground:            #e8e6e3;
  --sidebar-primary:               oklch(0.6724 0.1308 38.7559);
  --sidebar-primary-foreground:    #ffffff;
  --sidebar-accent:                #2e2e2c;
  --sidebar-accent-foreground:     #e8e6e3;
  --sidebar-border:                #363634;
  --sidebar-ring:                  oklch(0.6724 0.1308 38.7559);
}
```

### Original chat body background

`<SidebarInset>` had **no** background-color className — it inherited
`--background` (`#FAF9F5` in light mode, `#262624` in dark) via the
default `bg-background` styling baked into the primitive.

### Original sidebar header title

`components/full-chat-app.tsx` (the SidebarHeader title span):

```tsx
<span className="text-lg font-semibold">
  FabOrchestrator<span className="text-blue-500">.ai</span>
</span>
```

— inherited foreground color (warm dark slate), no `text-white`. The `.ai`
suffix was already `text-blue-500`; that survived the theme change.

### Original SidebarTrigger

```tsx
<SidebarTrigger className="size-8 shrink-0 border-0 bg-transparent shadow-none hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0" />
```

— no `text-slate-300` / `hover:text-white` classes.

### Original `<Sidebar>` element

```tsx
<Sidebar collapsible="icon" className="border-r">
```

No `style={{}}` prop, no arbitrary `[&_[data-sidebar=menu-button]]:text-white`
class. Menu buttons inherited `text-sidebar-foreground` from the global
theme (warm dark slate), got `hover:bg-sidebar-accent` (pale beige) on hover.

### Original scrollbar

There was no `[data-sidebar="content"]` block in `globals.css`. The sidebar
inherited the universal scrollbar rules at line 870-893 of `globals.css`:

```css
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--color-muted); border-radius: var(--radius-sm); }
::-webkit-scrollbar-thumb { background: var(--color-muted-foreground); border-radius: var(--radius-sm); }
::-webkit-scrollbar-thumb:hover { background: var(--color-foreground); }
* { scrollbar-width: thin; scrollbar-color: var(--color-muted-foreground) var(--color-muted); }
```

### Revert checklist

To restore the pre-blue-theme look exactly:

1. In `components/full-chat-app.tsx`, find the `<Sidebar>` element (~line 441):
   - Remove the inline `style={{ "--sidebar": "#0c1844", … }}` prop.
   - Replace `className="border-r [&_[data-sidebar=menu-button]]:text-white"`
     with `className="border-r"`.
2. In the same file, in the SidebarHeader title:
   - Remove `text-white` from the outer `<span>`.
   - Change `.ai` color back to `text-blue-500` (already correct — no change needed).
   - Remove `text-slate-300 ... hover:text-white` from the `<SidebarTrigger>`.
3. In the same file, on `<SidebarInset>`:
   - Replace `className="overflow-hidden bg-gradient-to-b from-white via-sky-50/40 to-white"`
     with `className="overflow-hidden"`.
4. In `app/globals.css`, delete the `[data-sidebar="content"]::-webkit-scrollbar{…}`
   block added after the universal scrollbar rules.

After reverting, run `npm run dev` and the sidebar should be back to warm
off-white with dark slate text, hover beige, default OS scrollbar.

---

## Re-deploy procedure (when ready to ship the blue theme)

The deployment doc covers the full flow; the Windows-specific gotcha is
that `Compress-Archive` writes backslash entry paths and EB on Linux
cannot read them. The first attempt of this release failed with that
exact symptom (`"source bundle has issues"`). Use the .NET `ZipFile` API
or `zip -r` from Git Bash / WSL to produce a POSIX-pathed zip.

PowerShell snippet that worked (forward-slash entry names):

```powershell
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = 'C:\Users\danis\Documents\two_applications\Claude_ai_athena'
$out = "$src\eb-deploy.zip"
$exclude = @('node_modules', '.next', '.git', '.env', '.claude', 'iam',
             'ref_docs', '_backup', 'eb-deploy.zip', 'admin-deploy.zip',
             'eb-deploy-req02.zip', 'source-req02.zip',
             'nexusops-source.zip', 'tsconfig.tsbuildinfo')

if (Test-Path $out) { Remove-Item $out -Force }
$zip = [System.IO.Compression.ZipFile]::Open(
  $out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Path $src -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length + 1)
    $top = ($rel -split '[\\\/]')[0]
    if ($exclude -contains $top) { return }
    $entry = $rel -replace '\\', '/'
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $_.FullName, $entry,
      [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $zip.Dispose() }
```

Then the standard EB upload / create-version / update-environment commands
from `DEPLOYMENT.md`.

---

*Document created 2026-05-19. Update when the blue-theme work ships.*
