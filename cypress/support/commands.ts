// Custom Cypress commands for auth and test helpers

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Register a new user, verify email, and sign in. Returns the email used. */
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

function getVerificationUrl(email: string): Cypress.Chainable<string> {
  return cy
    .request({
      url: `/api/test/verification-url?email=${encodeURIComponent(email)}`,
      retryOnStatusCodeFailure: true,
    })
    .then((res) => {
      const fullUrl = res.body.url as string
      return fullUrl.replace("http://localhost:3000", "")
    })
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

    cy.url({ timeout: 15000 }).should("include", "/verify-email")

    getVerificationUrl(email).then((url) => {
      cy.visit(url)
    })

    cy.visit("/login")
    cy.get("#email").type(email)
    cy.get("#password").type(password)
    cy.get("button[type=submit]").click()

    cy.url({ timeout: 15000 }).should("not.include", "/login")

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
