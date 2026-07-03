// Adds custom jest matchers for asserting on DOM nodes (toBeInTheDocument, etc.)
import "@testing-library/jest-dom"
// Adds the `toHaveNoViolations` matcher backed by axe-core
import "jest-axe/extend-expect"
