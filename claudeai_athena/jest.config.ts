import type { Config } from "jest"
import nextJest from "next/jest.js"

// next/jest loads next.config + .env files and sets up SWC transform for TS/TSX + CSS mocking
const createJestConfig = nextJest({
    // Path to the Next.js app to load next.config and .env files in the test environment
    dir: "./",
})

const config: Config = {
    // jsdom is required for rendering React components in @testing-library/react
    testEnvironment: "jsdom",
    // Run after the test framework is installed in the environment (jest-dom + jest-axe matchers)
    setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
    // Only pick up component/unit tests under __tests__/a11y. The existing
    // node:test error suite (__tests__/errors) is run separately via `test:errors`.
    testMatch: ["<rootDir>/__tests__/a11y/**/*.test.{ts,tsx}"],
    moduleNameMapper: {
        // Honour the "@/*" path alias from tsconfig.json
        "^@/(.*)$": "<rootDir>/$1",
    },
    // jest-axe needs a slightly longer default for the async scan
    testTimeout: 15000,
}

// createJestConfig is exported this way to ensure next/jest can load the
// async Next.js config (which is required) before Jest runs.
export default createJestConfig(config)
