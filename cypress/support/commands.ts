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

      /** Dismiss the POS receipt modal that appears after loan creation */
      dismissReceiptModal(): Chainable<void>
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

    // Registration may redirect to /verify-email (email verification required)
    // or /pending-approval / /dashboard (when CYPRESS=true disables verification).
    cy.url({ timeout: 15000 }).should("satisfy", (url: string) =>
      url.includes("/dashboard") ||
      url.includes("/pending-approval") ||
      url.includes("/verify-email")
    )

    cy.url().then((url) => {
      if (url.includes("/verify-email")) {
        // Email verification required: promote user (sets email_verified=true, invalidates session)
        // then log in fresh
        cy.task("db:promoteUser", { email, role: "superAdmin" })
        cy.clearCookies()
        cy.visit("/login")
        cy.get("#email").type(email)
        cy.get("#password").type(password)
        cy.get("button[type=submit]").click()
        cy.url({ timeout: 15000 }).should("include", "/dashboard")
      } else if (url.includes("/pending-approval")) {
        // User registered but needs role promotion
        cy.task("db:promoteUser", { email, role: "superAdmin" })
        cy.clearCookies()
        cy.visit("/login")
        cy.get("#email").type(email)
        cy.get("#password").type(password)
        cy.get("button[type=submit]").click()
        cy.url({ timeout: 15000 }).should("include", "/dashboard")
      }
      // else: already on /dashboard — first user auto-promoted, no action needed
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

Cypress.Commands.add("dismissReceiptModal", () => {
  cy.contains("SOVEREIGN LEDGER", { timeout: 10000 }).should("be.visible")
  cy.contains("button", "Close").click()
})

export {}
