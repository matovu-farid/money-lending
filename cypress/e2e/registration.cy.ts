describe("User Registration", () => {
  beforeEach(() => {
    cy.task("db:reset")
  })

  it("first user registers and lands on dashboard as superAdmin", () => {
    const email = `test-${Date.now()}@fidexa.org`

    cy.visit("/register")
    cy.contains("Create your account")

    cy.get("#name").type("First Admin")
    cy.get("#email").type(email)
    cy.get("#password").type("TestPass123!")
    cy.get("#confirmPassword").type("TestPass123!")
    cy.get("button[type=submit]").click()

    // Registration redirects to /pending-approval.
    // First user is auto-promoted to superAdmin by databaseHook.
    // The proxy may redirect to /dashboard if the session reflects the new role,
    // or the user may land on /pending-approval if the session is stale.
    cy.url({ timeout: 15000 }).should("satisfy", (url: string) =>
      url.includes("/dashboard") || url.includes("/pending-approval")
    )

    // If stuck on /pending-approval, sign out and sign back in to pick up superAdmin role
    cy.url().then((url) => {
      if (url.includes("/pending-approval")) {
        cy.clearCookies()
        cy.visit("/login")
        cy.get("#email").type(email)
        cy.get("#password").type("TestPass123!")
        cy.get("button[type=submit]").click()
        cy.url({ timeout: 15000 }).should("include", "/dashboard")
      }
    })

    // Verify user is superAdmin
    cy.task("db:getUserRole", { email }).then((result: any) => {
      expect(result.role).to.eq("superAdmin")
    })

    cy.contains("Dashboard")
  })

  it("second user registers and lands on pending-approval", () => {
    const adminEmail = `admin-${Date.now()}@fidexa.org`
    const userEmail = `user-${Date.now()}@fidexa.org`

    // Register first user (superAdmin)
    cy.visit("/register")
    cy.get("#name").type("Admin User")
    cy.get("#email").type(adminEmail)
    cy.get("#password").type("TestPass123!")
    cy.get("#confirmPassword").type("TestPass123!")
    cy.get("button[type=submit]").click()

    cy.url({ timeout: 15000 }).should("satisfy", (url: string) =>
      url.includes("/dashboard") || url.includes("/pending-approval")
    )

    cy.clearCookies()

    // Register second user
    cy.visit("/register")
    cy.get("#name").type("Regular User")
    cy.get("#email").type(userEmail)
    cy.get("#password").type("TestPass123!")
    cy.get("#confirmPassword").type("TestPass123!")
    cy.get("button[type=submit]").click()

    // Second user has role=unassigned -> stays on /pending-approval
    cy.url({ timeout: 15000 }).should("include", "/pending-approval")

    // Verify user role
    cy.task("db:getUserRole", { email: userEmail }).then((result: any) => {
      expect(result.role).to.eq("unassigned")
    })
  })
})
