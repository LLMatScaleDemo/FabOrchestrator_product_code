import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright config for FabOrchestrator.AI (dev server on port 3000).
 *
 * Viewport matrix exercises the three primary breakpoints used in manual QA:
 *   - Mobile   375x667  (iPhone SE)
 *   - Tablet   768x1024 (iPad)
 *   - Desktop  1280x800
 *
 * Tests live in ./e2e and run an @axe-core/playwright scan + a
 * horizontal-overflow check against the login/landing route.
 */
const PORT = 3000
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
    testDir: "./e2e",
    // a11y scans + page loads can be slow on a cold dev server
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL,
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "Mobile",
            use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 667 } },
        },
        {
            name: "Tablet",
            use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
        },
        {
            name: "Desktop",
            use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
        },
    ],
    webServer: {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
})
