// Cypress E2E support file
import "./commands"

// Suppress uncaught exceptions from the app (e.g. stale server action responses
// during session transitions). Tests that care about specific errors can
// override this in their own spec files.
Cypress.on("uncaught:exception", (_err) => {
  // Return false to prevent Cypress from failing the test
  return false
})
