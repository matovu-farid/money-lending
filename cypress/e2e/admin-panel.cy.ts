describe("Admin User Management", () => {
  let adminEmail: string
  const password = "TestPass123!"

  beforeEach(() => {
    cy.task("db:reset")

    // Register first user (superAdmin)
    cy.registerAndLogin({ name: "Super Admin", password }).then((email) => {
      adminEmail = email
    })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("admin page shows user management table", () => {
    cy.visit("/admin")
    cy.contains("Admin")
    cy.contains("System administration")

    // Table headers
    cy.contains("th", "Name")
    cy.contains("th", "Email")
    cy.contains("th", "Role")
    cy.contains("th", "Status")
    cy.contains("th", "Last Active")
  })

  it("shows the current superAdmin user in the table", () => {
    cy.visit("/admin")
    cy.contains("Super Admin")
    cy.contains(adminEmail)
  })

  it("shows Last Active date column (AUTH-04)", () => {
    cy.visit("/admin")
    // en-UG locale formats dates as "21 Mar 2026" (day month year)
    cy.get("[data-testid='data-row']")
      .first()
      .find("td")
      .last()
      .invoke("text")
      .should("match", /\w{3} \d{1,2}, \d{4}/)
  })

  describe("Role Management", () => {
    let userEmail: string

    beforeEach(() => {
      // Sign out and register a second user manually (don't auto-promote)
      cy.clearCookies()

      userEmail = `regular-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("Regular User")
      cy.get("#email").type(userEmail)
      cy.get("#password").type(password)
      cy.get("#confirmPassword").type(password)
      cy.get("button[type=submit]").click()

      // Second user lands on pending-approval (unassigned)
      cy.url({ timeout: 15000 }).should("include", "/pending-approval")

      // Sign out and log back in as superAdmin
      cy.clearCookies()
      cy.login(adminEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("superAdmin can change a user role via dropdown", () => {
      cy.visit("/admin")

      // Find the row for the regular user and change role
      cy.contains("tr", "Regular User").within(() => {
        // Should have a role dropdown for unassigned users
        cy.get("[data-slot=select-trigger]").click()
      })

      // Select loanOfficer from dropdown (portal renders outside the table row)
      cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
      cy.contains("[data-slot=select-item]", "Loan Officer").realClick()

      // Verify toast success
      cy.contains("Role updated", { timeout: 10000 })
    })

    it("role hierarchy limits dropdown options for admin vs superAdmin", () => {
      // First promote Regular User to admin level
      cy.task("db:promoteUser", { email: userEmail, role: "admin" })

      cy.visit("/admin")

      // SuperAdmin can change admin user's role, but "superAdmin" should not be an option
      cy.contains("tr", "Regular User").within(() => {
        cy.get("[data-slot=select-trigger]").click()
      })

      cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
      // The dropdown should NOT include "Super Admin" / "superAdmin" option
      cy.get("[data-slot=select-content]").should("not.contain", "Super Admin")
    })
  })

  describe("Access Control", () => {
    it("loanOfficer users see access denied on admin page", () => {
      cy.clearCookies()

      // Register second user manually
      const loEmail = `lo-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("No Access User")
      cy.get("#email").type(loEmail)
      cy.get("#password").type(password)
      cy.get("#confirmPassword").type(password)
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/pending-approval")

      // Promote to loanOfficer via DB, then re-login to pick up role
      cy.task("db:promoteUser", { email: loEmail, role: "loanOfficer" })
      cy.clearCookies()
      cy.login(loEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Visit admin page — should show access denied
      cy.visit("/admin")
      cy.contains("Access denied")
    })
  })
})
