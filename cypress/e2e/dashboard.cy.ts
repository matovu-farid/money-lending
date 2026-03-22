describe("Executive Dashboard", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Dashboard Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows 6 KPI cards with values", () => {
    cy.contains("Loans Outstanding").should("be.visible")
    cy.contains("Repayments Collected").should("be.visible")
    cy.contains("Interest Earned").should("be.visible")
    cy.contains("Active Borrowers").should("be.visible")
    cy.contains("Overdue Count").should("be.visible")
    cy.contains("Capital in System").should("be.visible")
  })

  it("shows KPI cards with UGX 0 for empty portfolio", () => {
    // With no loans, KPI values should be zero
    cy.contains("Loans Outstanding")
      .closest("[data-slot=card]")
      .should("contain", "UGX 0")
    cy.contains("Repayments Collected")
      .closest("[data-slot=card]")
      .should("contain", "UGX 0")
    cy.contains("Interest Earned")
      .closest("[data-slot=card]")
      .should("contain", "UGX 0")
    cy.contains("Active Borrowers")
      .closest("[data-slot=card]")
      .should("contain", "0")
    cy.contains("Overdue Count")
      .closest("[data-slot=card]")
      .should("contain", "0")
    cy.contains("Capital in System")
      .closest("[data-slot=card]")
      .should("contain", "UGX 0")
  })

  it("shows overdue count card without destructive styling when zero", () => {
    // With no overdue loans, the value should NOT have destructive (red) styling
    cy.contains("Overdue Count")
      .closest("[data-slot=card]")
      .find(".text-destructive")
      .should("not.exist")
  })

  it("shows Recent Activity section", () => {
    cy.contains("Recent Activity").should("be.visible")
  })

  it("shows empty activity state when no events", () => {
    cy.contains("No recent activity yet.").should("be.visible")
  })

  it("shows activity feed after issuing a loan", () => {
    // Create a customer
    cy.visit("/customers/new")
    cy.get("#fullName").type("Dashboard Borrower")
    cy.get("#contact").type("0771000001")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    // Issue a loan
    cy.url().then((url) => {
      const cid = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${cid}`)
      cy.get("#principalAmount").type("500000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").click()
      cy.get("[role=option]").contains("Land Title").click()
      cy.get("[data-base-ui-inert]").should("not.exist")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)
    })

    // Go back to dashboard and check activity
    cy.visit("/dashboard")
    cy.contains("No recent activity yet.").should("not.exist")
  })
})
