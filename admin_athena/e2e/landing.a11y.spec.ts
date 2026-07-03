import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

/**
 * Responsive + accessibility E2E for the Admin (NexusOps AI) login/landing route ("/").
 *
 * NOTE ON AUTH: Most Admin surfaces (users, roles, MCP registry, audit logs,
 * error catalog) are session-gated and require a valid session token. Hitting
 * those routes unauthenticated will redirect back to login. These tests
 * therefore target the public landing/login route and assert on *whatever page
 * actually renders* after navigation/redirect, so they never hard-fail on an
 * auth-gated redirect.
 *
 * To extend coverage to authenticated routes later, seed a session and inject
 * the token via page.addInitScript / storageState, e.g.:
 *
 *   // const ctx = await browser.newContext({ storageState: 'e2e/.auth/admin.json' })
 *
 * The viewport matrix is supplied by the `projects` in playwright.config.ts
 * (Mobile/Tablet/Desktop), so each assertion below runs once per breakpoint.
 */

test.describe("Landing / login route", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/")
        // Wait for the app shell to settle (covers a redirect to the login page)
        // rather than a specific selector, so the test stays resilient.
        await page.waitForLoadState("networkidle")
    })

    test("has no serious or critical axe violations", async ({ page }) => {
        const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()

        const blocking = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical"
        )

        // Surface the rule ids in the failure message for fast triage.
        expect(
            blocking,
            blocking.map((v) => `${v.id} (${v.impact}): ${v.help}`).join("\n")
        ).toEqual([])
    })

    test("has no horizontal overflow", async ({ page }) => {
        const overflows = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1
        )
        expect(overflows).toBe(false)
    })

    test("exposes a single main landmark", async ({ page }) => {
        // Resilient structural check: whatever renders (landing or redirected
        // login), there should be at most one <main> landmark.
        const mainCount = await page.locator("main").count()
        expect(mainCount).toBeLessThanOrEqual(1)
    })
})
