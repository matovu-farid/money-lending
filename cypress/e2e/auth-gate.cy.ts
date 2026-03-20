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
    // Register but don't promote — second user stays unassigned
    // First, create the first user (superAdmin)
    cy.registerAndLogin({ name: "First Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
    cy.clearCookies()

    // Second user stays unassigned
    cy.registerAndLogin({ name: "Unassigned User" })
    cy.url({ timeout: 15000 }).should("include", "/pending-approval")
    cy.contains("Pending Approval")
  })

  it("unassigned user on /pending-approval cannot navigate to /dashboard", () => {
    cy.registerAndLogin({ name: "First Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
    cy.clearCookies()

    cy.registerAndLogin({ name: "Blocked User" })
    cy.url({ timeout: 15000 }).should("include", "/pending-approval")

    // Try navigating to dashboard
    cy.visit("/dashboard")
    cy.url({ timeout: 10000 }).should("include", "/pending-approval")
  })

  it("assigned user visiting /login redirects to /dashboard", () => {
    const password = "TestPass123!"

    cy.registerAndLogin({ name: "Active User", password })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Try visiting login — should redirect back to dashboard
    cy.visit("/login")
    cy.url({ timeout: 10000 }).should("include", "/dashboard")
  })
})
