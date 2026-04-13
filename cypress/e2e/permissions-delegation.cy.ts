describe("Permission System & Delegation", () => {
  const password = "TestPass123!"
  let adminEmail: string
  let supervisorEmail: string

  beforeEach(() => {
    cy.task("db:reset")

    // Register first user (auto-promoted to superAdmin)
    cy.registerAndLogin({ name: "Super Admin", password }).then((email) => {
      adminEmail = email
    })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Register a second user, promote to supervisor
    cy.registerAndLogin({ name: "Test Supervisor", password }).then((email) => {
      supervisorEmail = email
    })
    cy.promoteUser(supervisorEmail, "supervisor")
  })

  describe("Role-based page access", () => {
    it("loan officer is redirected from dashboard to loans", () => {
      // Register a loan officer
      cy.registerAndLogin({ name: "Loan Officer", password }).then((email) => {
        cy.promoteUser(email, "loanOfficer")
        cy.login(email, password)
      })
      cy.visit("/dashboard")
      cy.url({ timeout: 10000 }).should("include", "/loans")
    })

    it("supervisor can access dashboard", () => {
      cy.login(supervisorEmail, password)
      cy.visit("/dashboard")
      cy.url({ timeout: 10000 }).should("include", "/dashboard")
      cy.contains("Dashboard")
    })

    it("supervisor is redirected from admin to dashboard", () => {
      cy.login(supervisorEmail, password)
      cy.visit("/admin")
      cy.url({ timeout: 10000 }).should("include", "/dashboard")
    })

    it("superAdmin can access admin page", () => {
      cy.login(adminEmail, password)
      cy.visit("/admin")
      cy.url({ timeout: 10000 }).should("include", "/admin")
      cy.contains("Admin")
    })
  })

  describe("Sidebar navigation visibility", () => {
    it("supervisor sees dashboard and approvals in nav", () => {
      cy.login(supervisorEmail, password)
      cy.visit("/dashboard")
      cy.get("nav").should("contain", "Dashboard")
      cy.get("nav").should("contain", "Approvals")
      cy.get("nav").should("contain", "Creditors")
    })

    it("loan officer does not see dashboard or admin in nav", () => {
      cy.registerAndLogin({ name: "LO Nav Test", password }).then((email) => {
        cy.promoteUser(email, "loanOfficer")
        cy.login(email, password)
      })
      cy.visit("/loans")
      cy.get("nav").should("contain", "Loans")
      cy.get("nav").should("contain", "Payments")
      cy.get("nav").should("not.contain", "Dashboard")
      cy.get("nav").should("not.contain", "Admin")
    })
  })

  describe("Delegation management", () => {
    it("admin page shows delegation section", () => {
      cy.login(adminEmail, password)
      cy.visit("/admin")
      cy.contains("Active Delegations")
      cy.contains("No active delegations")
    })

    it("admin can delegate to supervisor and see Managing Supervisor badge", () => {
      cy.login(adminEmail, password)
      cy.visit("/admin")

      // Find the Delegate button next to the supervisor
      cy.contains("button", "Delegate").click()

      // Should show the active delegation
      cy.contains("Managing Supervisor").should("be.visible")
    })

    it("admin can revoke a delegation", () => {
      cy.login(adminEmail, password)
      cy.visit("/admin")

      // Delegate first
      cy.contains("button", "Delegate").click()
      cy.contains("Managing Supervisor").should("be.visible")

      // Revoke
      cy.contains("button", "Revoke").click()
      cy.contains("Delegation revoked").should("be.visible")
      cy.contains("No active delegations").should("be.visible")
    })

    it("delegation history shows after revocation", () => {
      cy.login(adminEmail, password)
      cy.visit("/admin")

      // Delegate then revoke
      cy.contains("button", "Delegate").click()
      cy.contains("Managing Supervisor").should("be.visible")
      cy.contains("button", "Revoke").click()

      // Check history
      cy.contains("Delegation History (1)").click()
      cy.contains("Test Supervisor")
    })
  })
})
