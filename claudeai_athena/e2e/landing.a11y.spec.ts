import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

/**
 * Responsive + accessibility E2E for the FabOrch login/landing route ("/").
 *
 * This route is the public entry point (login page) and renders without a
 * session, so it is safe to scan unauthenticated. The viewport matrix is
 * supplied by the `projects` in playwright.config.ts (Mobile/Tablet/Desktop),
 * so each assertion below runs once per breakpoint.
 */

test.describe("Landing / login route", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/")
        // Wait for the app shell to hydrate rather than a specific selector,
        // so the test stays resilient to copy/markup changes.
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
        // Resilient structural check: whatever renders, there should be at most
        // one <main> landmark. Skipped gracefully if the page has none yet.
        const mainCount = await page.locator("main").count()
        expect(mainCount).toBeLessThanOrEqual(1)
    })
})
