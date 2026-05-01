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
    // Admin page renders a LoadingSkeleton until TanStack DB collections sync
    // via Electric — wait for that to complete before asserting on content.
    cy.contains("System administration", { timeout: 30000 })
    cy.contains("Admin")

    // Table headers
    cy.contains("th", "Name")
    cy.contains("th", "Email")
    cy.contains("th", "Role")
    cy.contains("th", "Status")
    cy.contains("th", "Joined")
  })

  it("shows the current superAdmin user in the table", () => {
    cy.visit("/admin")
    cy.contains("Super Admin", { timeout: 30000 })
    cy.contains(adminEmail)
  })

  it("shows Last Active date column (AUTH-04)", () => {
    cy.visit("/admin")
    // en-UG locale formats dates as "21 Mar 2026" (day month year)
    cy.get("[data-testid='data-row']", { timeout: 30000 })
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
      // Wait for Electric sync before interacting with the table
      cy.contains("tr", "Regular User", { timeout: 30000 }).within(() => {
        cy.get("[data-slot=select-trigger]").click()
      })

      // Wait for dropdown to be open, then use keyboard to select Loan Officer
      cy.get("[data-slot=select-content]").should("exist")
      // Type the first letter to jump to matching item, then enter
      cy.focused().type("l{enter}")

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
    it("loanOfficer users are redirected away from admin page", () => {
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

      // The admin layout redirects users without user:list permission to /dashboard.
      // (See src/app/(app)/admin/layout.tsx — redirect added in commit e050d4d)
      cy.visit("/admin")
      cy.url({ timeout: 30000 }).should("include", "/dashboard")
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders admin panel at mobile with tab bar", () => {
      cy.visit("/admin")
      // Wait for Electric sync to finish so the admin page renders past skeleton
      cy.get("h1", { timeout: 30000 }).should("be.visible")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })
  })
})
