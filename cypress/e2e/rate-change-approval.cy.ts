// cypress/e2e/rate-change-approval.cy.ts
describe("Rate Change Approval Flow", () => {
  const password = "TestPass123!"
  let superAdminEmail: string
  let loanOfficerEmail: string
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")

    // Register first user (superAdmin)
    cy.registerAndLogin({ name: "Super Admin", password }).then((email) => {
      superAdminEmail = email
    })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer
    cy.visit("/customers")
    cy.contains("Add Customer").click()
    cy.get("#fullName").type("Rate Test Customer")
    cy.get("#nin").type("C1234567890123")
    cy.get("#contact").type("0700111222")
    cy.get("#address").type("Test Address")
    cy.get("button[type=submit]").click()
    cy.contains("Customer created", { timeout: 10000 })

    // Navigate to customer and create a loan
    cy.contains("Rate Test Customer").click()
    cy.url().then((url) => {
      url.split("/customers/")[1]
    })

    // Create a loan via the loans page
    cy.visit("/loans/new")
    cy.get("[data-testid=customer-search]").type("Rate Test")
    cy.contains("Rate Test Customer").click()
    cy.get("#principalAmount").clear().type("1000000")
    cy.get("#interestRate").clear().type("10")
    // Start date defaults to today; the picker is a button rather than a typeable input
    cy.get("#collateralNature").type("Land Title")
    cy.get("button[type=submit]").click()
    cy.contains("Loan created", { timeout: 10000 })

    // Get the loan ID from the URL
    cy.url({ timeout: 10000 }).should("include", "/loans/").then((url) => {
      const parts = url.split("/loans/")
      if (parts[1]) {
        loanId = parts[1].split("?")[0]
      }
    })
  })

  describe("Approvals page access", () => {
    it("renders approvals page for supervisor+ users", () => {
      cy.visit("/approvals")
      cy.contains("Approvals")
      cy.contains("Rate change requests pending your review")
      cy.contains("No pending requests")
    })

    it("shows access denied for loan officers", () => {
      // Register a loan officer
      cy.clearCookies()
      loanOfficerEmail = `lo-rate-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("Loan Officer")
      cy.get("#email").type(loanOfficerEmail)
      cy.get("#password").type(password)
      cy.get("#confirmPassword").type(password)
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/pending-approval")

      cy.task("db:promoteUser", { email: loanOfficerEmail, role: "loanOfficer" })
      cy.clearCookies()
      cy.login(loanOfficerEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/approvals")
      cy.contains("Access denied")
    })
  })

  describe("Rate change request from loan detail", () => {
    it("superAdmin can change rate immediately (role meets threshold)", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Request Rate Change").click()

      // Change rate to 9% (supervisor threshold, but superAdmin meets it)
      cy.get("#newRate").clear().type("9.0")
      cy.contains("Submit Request").click()

      cy.contains("Interest rate updated immediately", { timeout: 10000 })

      // Verify the rate card shows the new rate
      cy.contains("9.0%")
    })
  })

  describe("Full approval flow", () => {
    it("loan officer request -> supervisor approves -> rate updated", () => {
      // Register a loan officer
      cy.clearCookies()
      loanOfficerEmail = `lo-flow-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("LO Flow User")
      cy.get("#email").type(loanOfficerEmail)
      cy.get("#password").type(password)
      cy.get("#confirmPassword").type(password)
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/pending-approval")

      // Promote to loanOfficer
      cy.task("db:promoteUser", { email: loanOfficerEmail, role: "loanOfficer" })
      cy.clearCookies()
      cy.login(loanOfficerEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Request rate change to 9% (requires supervisor)
      cy.visit(`/loans/${loanId}`)
      cy.contains("Request Rate Change").click()
      cy.get("#newRate").clear().type("9.0")
      cy.contains("Submit Request").click()
      cy.contains("submitted for supervisor approval", { timeout: 10000 })

      // Verify pending badge shows on loan detail
      cy.contains("Pending: 9.0%")

      // Now login as superAdmin and approve
      cy.clearCookies()
      cy.login(superAdminEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/approvals")
      cy.get("[data-testid=pending-request-row]").should("have.length.gte", 1)
      cy.get("[data-testid=pending-request-row]").first().within(() => {
        cy.contains("9.0%")
        cy.get("[aria-label=Approve]").click()
      })

      cy.contains("Approve & Apply").click()
      cy.contains("Rate change approved and applied", { timeout: 10000 })

      // Verify the loan rate was updated
      cy.visit(`/loans/${loanId}`)
      cy.contains("9.0%")
    })
  })

  describe("Rejection flow", () => {
    it("loan officer request -> admin rejects -> rate unchanged", () => {
      // Register a loan officer
      cy.clearCookies()
      loanOfficerEmail = `lo-reject-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("LO Reject User")
      cy.get("#email").type(loanOfficerEmail)
      cy.get("#password").type(password)
      cy.get("#confirmPassword").type(password)
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/pending-approval")

      cy.task("db:promoteUser", { email: loanOfficerEmail, role: "loanOfficer" })
      cy.clearCookies()
      cy.login(loanOfficerEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Request rate change to 5% (requires admin)
      cy.visit(`/loans/${loanId}`)
      cy.contains("Request Rate Change").click()
      cy.get("#newRate").clear().type("5.0")
      cy.contains("Submit Request").click()
      cy.contains("submitted for admin approval", { timeout: 10000 })

      // Login as superAdmin and reject
      cy.clearCookies()
      cy.login(superAdminEmail, password)
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/approvals")
      cy.get("[data-testid=pending-request-row]").first().within(() => {
        cy.get("[aria-label=Reject]").click()
      })

      cy.get("#reviewNote").type("Rate too low for this customer's risk profile")
      cy.contains("button", "Reject").click()
      cy.contains("Rate change request rejected", { timeout: 10000 })

      // Verify in recently reviewed section
      cy.contains("Recently Reviewed")
      cy.get("[data-testid=reviewed-request-row]").should("have.length.gte", 1)
      cy.get("[data-testid=reviewed-request-row]").first().within(() => {
        cy.contains("rejected")
      })

      // Verify loan rate is unchanged
      cy.visit(`/loans/${loanId}`)
      cy.contains("10.0%")
    })
  })

  describe("Sidebar navigation", () => {
    it("shows Approvals link in Operations group", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid=sidebar-nav]").within(() => {
        cy.contains("Approvals")
      })
    })

    it("navigates to /approvals from sidebar", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid=sidebar-nav]").within(() => {
        cy.contains("Approvals").click()
      })
      cy.url().should("include", "/approvals")
    })
  })
})
