/**
 * Accessibility smoke test for presentational UI primitives.
 *
 * These components are pure/presentational (no DB, network, or context
 * providers required), so they render synchronously in jsdom and are a good
 * canary for axe-core regressions. Add more primitives here as needed.
 *
 * Run with: npm run test:a11y
 */
import { render } from "@testing-library/react"
import { axe } from "jest-axe"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

describe("UI primitive accessibility", () => {
    it("Button has no detectable a11y violations", async () => {
        const { container } = render(<Button>Save changes</Button>)
        expect(await axe(container)).toHaveNoViolations()
    })

    it("Button (icon variant) needs an accessible name and passes when labelled", async () => {
        const { container } = render(
            <Button size="icon" aria-label="Close dialog">
                <svg aria-hidden="true" width="16" height="16" />
            </Button>
        )
        expect(await axe(container)).toHaveNoViolations()
    })

    it("Badge has no detectable a11y violations", async () => {
        const { container } = render(<Badge variant="secondary">Active</Badge>)
        expect(await axe(container)).toHaveNoViolations()
    })
})
