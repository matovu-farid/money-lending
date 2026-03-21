// Custom Cypress commands for auth and test helpers

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Register a new user, promote to superAdmin if needed, and land on dashboard. Returns email. */
      registerAndLogin(opts?: {
        name?: string
        email?: string
        password?: string
      }): Chainable<string>

      /** Sign in with existing credentials */
      login(email: string, password: string): Chainable<void>

      /** Promote a user to a specific role via db task */
      promoteUser(email: string, role: string): Chainable<null>
    }
  }
}

Cypress.Commands.add(
  "registerAndLogin",
  (opts?: { name?: string; email?: string; password?: string }) => {
    const email = opts?.email ?? `test-${Date.now()}@fidexa.org`
    const name = opts?.name ?? "Test User"
    const password = opts?.password ?? "TestPass123!"

    cy.visit("/register")
    cy.get("#name").type(name)
    cy.get("#email").type(email)
    cy.get("#password").type(password)
    cy.get("#confirmPassword").type(password)
    cy.get("button[type=submit]").click()

    // Registration redirects to /pending-approval.
    // First user is auto-promoted to superAdmin by databaseHook, so proxy bounces to /dashboard.
    // Subsequent users stay at /pending-approval until promoted.
    cy.url({ timeout: 15000 }).should("satisfy", (url: string) =>
      url.includes("/dashboard") || url.includes("/pending-approval")
    )

    // If user landed on /pending-approval, promote them and re-login
    cy.url().then((url) => {
      if (url.includes("/pending-approval")) {
        cy.task("db:promoteUser", { email, role: "superAdmin" })
        cy.clearCookies()
        cy.visit("/login")
        cy.get("#email").type(email)
        cy.get("#password").type(password)
        cy.get("button[type=submit]").click()
        cy.url({ timeout: 15000 }).should("include", "/dashboard")
      }
    })

    cy.wrap(email)
  }
)

Cypress.Commands.add("login", (email: string, password: string) => {
  cy.visit("/login")
  cy.get("#email").type(email)
  cy.get("#password").type(password)
  cy.get("button[type=submit]").click()
  cy.url({ timeout: 15000 }).should("not.include", "/login")
})

Cypress.Commands.add("promoteUser", (email: string, role: string) => {
  return cy.task("db:promoteUser", { email, role })
})

export {}
