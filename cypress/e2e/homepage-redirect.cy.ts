describe("Homepage Redirect", () => {
  beforeEach(() => {
    cy.task("db:reset")
  })

  it("unauthenticated user visiting / redirects to /login", () => {
    cy.visit("/")
    cy.url({ timeout: 10000 }).should("include", "/login")
    cy.contains("Sign in")
  })

  it("authenticated user visiting / redirects to /dashboard", () => {
    cy.registerAndLogin({ name: "Home User" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Now visit the homepage — should redirect to /dashboard
    cy.visit("/")
    cy.url({ timeout: 10000 }).should("include", "/dashboard")
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("redirects to dashboard at mobile viewport", () => {
      cy.registerAndLogin({ name: "Mobile Home User" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/")
      cy.url({ timeout: 10000 }).should("include", "/dashboard")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
    })
  })
})
