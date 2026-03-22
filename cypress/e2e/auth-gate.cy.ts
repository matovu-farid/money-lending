describe("Auth Gate (proxy.ts)", () => {
  beforeEach(() => {
    cy.task("db:reset")
  })

  it("unauthenticated user visiting /dashboard redirects to /login", () => {
    cy.visit("/dashboard")
    cy.url({ timeout: 10000 }).should("include", "/login")
  })

  it("unauthenticated user visiting /customers redirects to /login", () => {
    cy.visit("/customers")
    cy.url({ timeout: 10000 }).should("include", "/login")
  })

  it("unauthenticated user visiting /loans redirects to /login", () => {
    cy.visit("/loans")
    cy.url({ timeout: 10000 }).should("include", "/login")
  })

  it("unauthenticated user can access /login directly", () => {
    cy.visit("/login")
    cy.url().should("include", "/login")
    cy.contains("Sign in")
  })

  it("unauthenticated user can access /register directly", () => {
    cy.visit("/register")
    cy.url().should("include", "/register")
    cy.contains("Create your account")
  })

  it("unassigned user redirects to /pending-approval", () => {
    // First user becomes superAdmin
    cy.registerAndLogin({ name: "First Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
    cy.clearCookies()

    // Register second user manually (don't use registerAndLogin which auto-promotes)
    const email = `unassigned-${Date.now()}@fidexa.org`
    cy.visit("/register")
    cy.get("#name").type("Unassigned User")
    cy.get("#email").type(email)
    cy.get("#password").type("TestPass123!")
    cy.get("#confirmPassword").type("TestPass123!")
    cy.get("button[type=submit]").click()

    cy.url({ timeout: 15000 }).should("include", "/pending-approval")
    cy.contains("Pending Approval")
  })

  it("unassigned user on /pending-approval cannot navigate to /dashboard", () => {
    // First user becomes superAdmin
    cy.registerAndLogin({ name: "First Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
    cy.clearCookies()

    // Register second user manually
    const email = `blocked-${Date.now()}@fidexa.org`
    cy.visit("/register")
    cy.get("#name").type("Blocked User")
    cy.get("#email").type(email)
    cy.get("#password").type("TestPass123!")
    cy.get("#confirmPassword").type("TestPass123!")
    cy.get("button[type=submit]").click()

    cy.url({ timeout: 15000 }).should("include", "/pending-approval")

    // Try navigating to dashboard
    cy.visit("/dashboard")
    cy.url({ timeout: 10000 }).should("include", "/pending-approval")
  })

  it("assigned user visiting /login redirects to /dashboard", () => {
    cy.registerAndLogin({ name: "Active User" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Try visiting login — should redirect back to dashboard
    cy.visit("/login")
    cy.url({ timeout: 10000 }).should("include", "/dashboard")
  })
})
