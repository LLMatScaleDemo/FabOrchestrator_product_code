# Responsive & Accessibility QA — Admin (NexusOps AI)

This document covers the responsive + accessibility (a11y) testing infrastructure for
the **Admin** app (`two_applications/admin_athena`, dev server on **port 3001**),
plus the manual sign-off matrix and checklists.

Target standard: **WCAG 2.1 AA**. Lighthouse accessibility gate: **score ≥ 0.95**.

---

## 1. Tooling overview

| Layer | Tool | What it covers |
|---|---|---|
| Component a11y (unit) | `jest` + `jest-axe` + `@testing-library/react` | axe-core scan of individual React components in jsdom |
| E2E responsive + a11y | `@playwright/test` + `@axe-core/playwright` | Real-browser axe scan + horizontal-overflow check across 3 viewports |
| Page audit | `lighthouse` | Accessibility category score against the running prod server |

### First-time setup

```bash
cd two_applications/admin_athena
npm install          # installs the new devDependencies
npx playwright install   # one-time: download Playwright browsers
```

> Note: `npm install` and `npx playwright install` require network access and are **not**
> run as part of authoring this infra — a developer must run them once locally/CI.

---

## 2. Running the tests

### 2.1 Component a11y (jest-axe)

```bash
npm run test:a11y
```

- Config: `jest.config.ts` (uses the `next/jest` preset, jsdom environment, setup in `jest.setup.ts`).
- Tests live under `__tests__/a11y/`. The example `ui-primitives.test.tsx` renders the
  `Button` and `Badge` primitives and asserts `expect(await axe(container)).toHaveNoViolations()`.
- This suite is **separate** from the existing `npm run test:errors` (node:test) suite —
  `jest` only picks up `__tests__/a11y/**`.
- Add a new test per component: render it (wrap in required providers if any) and run `axe`.

### 2.2 E2E responsive + a11y (Playwright)

```bash
npm run test:e2e
# single viewport:
npx playwright test --project=Mobile
```

- Config: `playwright.config.ts`. `webServer` auto-starts `npm run dev` (which pins `--port 3001`)
  with `reuseExistingServer` (uses an already-running dev server if present).
- Viewport matrix (`projects`): **Mobile 375×667**, **Tablet 768×1024**, **Desktop 1280×800**.
  Every test runs once per viewport.
- `e2e/landing.a11y.spec.ts` loads `/` and asserts:
  - no axe violations of impact **serious** or **critical** (tags wcag2a/2aa/21a/21aa),
  - no horizontal overflow: `document.documentElement.scrollWidth <= window.innerWidth + 1`,
  - at most one `<main>` landmark.

> **Auth note:** Most Admin surfaces (users, roles, MCP registry, audit logs, error catalog)
> are **session-gated**. Unauthenticated requests redirect to login. The E2E spec therefore
> targets the public landing/login route and asserts on whatever page actually renders, so it
> does **not** hard-fail on an auth redirect. To extend coverage to authenticated routes, seed
> a session token and inject it via Playwright `storageState` / `page.addInitScript` (see the
> commented stub in `e2e/landing.a11y.spec.ts`).

### 2.3 Lighthouse accessibility audit

```bash
# 1. build + start the prod server (separate terminal) — Admin start pins port 3001
npm run build && npm run start    # serves on http://localhost:3001
# 2. run the audit
npm run lighthouse:a11y
```

- Outputs `admin-a11y.report.json` + `.report.html` to `./.lighthouse/` (gitignored).
- **Gate:** accessibility category score must be **≥ 0.95**. This is a manual/CI review
  gate, not enforced programmatically — open the HTML report and confirm the score.

---

## 3. Manual QA matrix — devices × breakpoints

Sign off each cell visually (layout intact, no clipped/overlapping content, tap targets ≥ 44×44px).

| Surface | iPhone SE (375×667) | iPad (768×1024) | Desktop (1280×800) |
|---|---|---|---|
| Login / landing (`/`) | ☐ | ☐ | ☐ |
| Admin assistant chat shell | ☐ | ☐ | ☐ |
| Cockpit dashboard (charts/cards) | ☐ | ☐ | ☐ |
| Users table + row actions | ☐ | ☐ | ☐ |
| Roles management | ☐ | ☐ | ☐ |
| MCP registry list/form | ☐ | ☐ | ☐ |
| Audit logs table (session/error/prompt) | ☐ | ☐ | ☐ |
| Error catalog table | ☐ | ☐ | ☐ |
| Confirm/alert dialogs + toasts | ☐ | ☐ | ☐ |

Tailwind breakpoints in use: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536.
Note: data tables use `@tanstack/react-table`; verify horizontal scroll containers (not page overflow)
on narrow viewports and that charts (`recharts`) reflow.

---

## 4. Keyboard-only checklist

Test with mouse unplugged / not used:

- ☐ **Tab order** is logical and follows visual reading order; no keyboard traps.
- ☐ **Skip link** ("Skip to main content") is the first focusable element and works.
- ☐ **Focus is always visible** (focus ring not suppressed) on every interactive element.
- ☐ **Enter / Space** activate buttons and links.
- ☐ **Escape** closes dialogs (Radix `alert-dialog`/`dialog`), dropdowns, sheets, and toasts;
  focus returns to the trigger.
- ☐ **Arrow keys** navigate dropdown menus, tabs, and table-internal controls.
- ☐ Modal/sheet/confirm-dialog open **traps focus** inside and restores focus to the opener on close.
- ☐ Data tables: sortable headers and row actions are keyboard-operable.
- ☐ No functionality is mouse-only (hover-only menus have a keyboard equivalent).

---

## 5. Screen-reader checklist (VoiceOver / NVDA)

- ☐ **Landmarks**: page exposes `banner`/`nav`/`main`/`complementary`/`contentinfo` as appropriate;
  exactly one `main`.
- ☐ **Headings** form a sensible outline (single h1, no skipped levels).
- ☐ **Button labels**: icon-only buttons have `aria-label`/visually-hidden text; decorative icons `aria-hidden`.
- ☐ **Form fields** have associated `<label>`s (login, role/MCP forms).
- ☐ **Table headers** (`<th scope=col/row>`) announced for every data table (users, roles, audit, catalog).
- ☐ **Live regions**: `sonner` toasts + streaming assistant responses announced via `aria-live` (polite).
- ☐ **Charts** (`recharts`) have a text/table alternative or `aria-label` summarising the data.
- ☐ **Dialogs** announce role `dialog`/`alertdialog` + accessible name; background is inert.
- ☐ **State changes** (loading, saved, error) are announced.

---

## 6. WCAG 2.1 AA success-criteria sign-off

| SC | Criterion | Status |
|---|---|---|
| 1.1.1 | Non-text content has text alternatives | ☐ |
| 1.3.1 | Info & relationships conveyed in markup (semantics, labels, table headers) | ☐ |
| 1.3.4 | Orientation not locked | ☐ |
| 1.3.5 | Input purpose identified (autocomplete on login fields) | ☐ |
| 1.4.3 | Contrast (text) ≥ 4.5:1 (≥ 3:1 large) | ☐ |
| 1.4.4 | Text resizes to 200% without loss of content | ☐ |
| 1.4.10 | Reflow at 320px width, no 2-D scroll (tables may scroll within a container) | ☐ |
| 1.4.11 | Non-text contrast ≥ 3:1 (controls, chart elements, focus indicators) | ☐ |
| 1.4.12 | Text spacing adjustable without clipping | ☐ |
| 1.4.13 | Content on hover/focus dismissable & persistent | ☐ |
| 2.1.1 | All functionality keyboard-operable | ☐ |
| 2.1.2 | No keyboard trap | ☐ |
| 2.4.1 | Bypass blocks (skip link / landmarks) | ☐ |
| 2.4.3 | Focus order preserves meaning | ☐ |
| 2.4.6 | Headings & labels are descriptive | ☐ |
| 2.4.7 | Focus visible | ☐ |
| 2.5.3 | Label in name (visible label matches accessible name) | ☐ |
| 3.1.1 | Page language set (`<html lang>`) | ☐ |
| 3.2.1 / 3.2.2 | No unexpected context change on focus/input | ☐ |
| 3.3.1 | Error identification on forms | ☐ |
| 3.3.2 | Labels/instructions for inputs | ☐ |
| 4.1.2 | Name/role/value for all UI components | ☐ |
| 4.1.3 | Status messages via live regions (toasts) | ☐ |

Sign-off requires: all automated suites green, Lighthouse a11y ≥ 0.95, and all manual cells checked.
