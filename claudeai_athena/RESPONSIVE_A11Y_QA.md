# Responsive & Accessibility QA — FabOrchestrator.AI

This document covers the responsive + accessibility (a11y) testing infrastructure for
the **FabOrch** app (`two_applications/Claude_ai_athena`, dev server on **port 3000**),
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
cd two_applications/Claude_ai_athena
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

- Config: `playwright.config.ts`. `webServer` auto-starts `npm run dev` on port 3000 with
  `reuseExistingServer` (uses an already-running dev server if present).
- Viewport matrix (`projects`): **Mobile 375×667**, **Tablet 768×1024**, **Desktop 1280×800**.
  Every test runs once per viewport.
- `e2e/landing.a11y.spec.ts` loads `/` (login/landing) and asserts:
  - no axe violations of impact **serious** or **critical** (tags wcag2a/2aa/21a/21aa),
  - no horizontal overflow: `document.documentElement.scrollWidth <= window.innerWidth + 1`,
  - at most one `<main>` landmark.
- The landing route is the public login page, so it is scannable without a session.

### 2.3 Lighthouse accessibility audit

```bash
# 1. build + start the prod server (separate terminal)
npm run build && npm run start    # serves on http://localhost:3000
# 2. run the audit
npm run lighthouse:a11y
```

- Outputs `faborch-a11y.report.json` + `.report.html` to `./.lighthouse/` (gitignored).
- **Gate:** accessibility category score must be **≥ 0.95**. This is a manual/CI review
  gate, not enforced programmatically — open the HTML report and confirm the score.

---

## 3. Manual QA matrix — devices × breakpoints

Sign off each cell visually (layout intact, no clipped/overlapping content, tap targets ≥ 44×44px).

| Surface | iPhone SE (375×667) | iPad (768×1024) | Desktop (1280×800) |
|---|---|---|---|
| Login / landing (`/`) | ☐ | ☐ | ☐ |
| Chat shell — sidebar collapsed/overlay | ☐ | ☐ | ☐ |
| Chat shell — message list + input | ☐ | ☐ | ☐ |
| Model selector dropdown | ☐ | ☐ | ☐ |
| Settings modal | ☐ | ☐ | ☐ |
| File upload / document viewer | ☐ | ☐ | ☐ |
| Sign-out / account dropdown | ☐ | ☐ | ☐ |

Tailwind breakpoints in use: `sm` 640, `md` 768 (mobile cutoff), `lg` 1024, `xl` 1280, `2xl` 1536.
Mobile detection hook: `hooks/use-mobile.tsx` (< 768px).

---

## 4. Keyboard-only checklist

Test with mouse unplugged / not used:

- ☐ **Tab order** is logical and follows visual reading order; no keyboard traps.
- ☐ **Skip link** ("Skip to main content") is the first focusable element and works.
- ☐ **Focus is always visible** (focus ring not suppressed) on every interactive element.
- ☐ **Enter / Space** activate buttons and links.
- ☐ **Escape** closes dialogs, dropdowns, sheets, and the settings modal; focus returns to the trigger.
- ☐ **Arrow keys** navigate menus / dropdown items.
- ☐ Modal/sheet open **traps focus** inside and restores focus to the opener on close.
- ☐ Chat input shortcuts (Cmd/Ctrl+Enter to send, Cmd/Ctrl+K) reachable and documented.
- ☐ No functionality is mouse-only (hover-only menus have a keyboard equivalent).

---

## 5. Screen-reader checklist (VoiceOver / NVDA)

- ☐ **Landmarks**: page exposes `banner`/`nav`/`main`/`complementary`/`contentinfo` as appropriate;
  exactly one `main`.
- ☐ **Headings** form a sensible outline (single h1, no skipped levels).
- ☐ **Button labels**: icon-only buttons have `aria-label`/visually-hidden text; decorative icons `aria-hidden`.
- ☐ **Form fields** have associated `<label>`s (login email/password, settings inputs).
- ☐ **Table headers** (`<th scope=...>`) announced for any tabular data.
- ☐ **Live regions**: streaming assistant responses / toasts announced via `aria-live` (polite) without spamming.
- ☐ **Images** have meaningful `alt` (or empty `alt` if decorative).
- ☐ **Dialogs** announce role `dialog` + accessible name; background is inert.
- ☐ **State changes** (loading, sent, error) are announced.

---

## 6. WCAG 2.1 AA success-criteria sign-off

| SC | Criterion | Status |
|---|---|---|
| 1.1.1 | Non-text content has text alternatives | ☐ |
| 1.3.1 | Info & relationships conveyed in markup (semantics, labels, headers) | ☐ |
| 1.3.4 | Orientation not locked | ☐ |
| 1.3.5 | Input purpose identified (autocomplete on login fields) | ☐ |
| 1.4.3 | Contrast (text) ≥ 4.5:1 (≥ 3:1 large) | ☐ |
| 1.4.4 | Text resizes to 200% without loss of content | ☐ |
| 1.4.10 | Reflow at 320px width, no 2-D scroll | ☐ |
| 1.4.11 | Non-text contrast ≥ 3:1 (controls, focus indicators) | ☐ |
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
| 4.1.3 | Status messages via live regions | ☐ |

Sign-off requires: all automated suites green, Lighthouse a11y ≥ 0.95, and all manual cells checked.
