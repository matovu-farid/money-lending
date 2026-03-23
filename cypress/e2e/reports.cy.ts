describe("Reports", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Reports Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows reports hub page with heading", () => {
    cy.visit("/reports")
    cy.contains("Reports", { timeout: 15000 }).should("be.visible")
    cy.contains("Financial reporting and analytics").should("be.visible")
  })

  it("shows all 4 report cards", () => {
    cy.visit("/reports")
    cy.contains("Loan Portfolio", { timeout: 15000 }).should("be.visible")
    cy.contains("Profit & Loss").should("be.visible")
    cy.contains("Balance Sheet").should("be.visible")
    cy.contains("Transaction Log").should("be.visible")
  })

  it("navigates to Loan Portfolio report", () => {
    cy.visit("/reports")
    cy.contains("Loan Portfolio", { timeout: 15000 })
      .closest("[data-slot=card]")
      .contains("View Report")
      .click()
    cy.url().should("include", "/reports/portfolio")
  })

  it("navigates to Profit & Loss report", () => {
    cy.visit("/reports")
    cy.contains("Profit & Loss", { timeout: 15000 })
      .closest("[data-slot=card]")
      .contains("View Report")
      .click()
    cy.url().should("include", "/reports/pnl")
  })

  it("navigates to Balance Sheet report", () => {
    cy.visit("/reports")
    cy.contains("Balance Sheet", { timeout: 15000 })
      .closest("[data-slot=card]")
      .contains("View Report")
      .click()
    cy.url().should("include", "/reports/balance-sheet")
  })

  it("navigates to Transaction Log from reports", () => {
    cy.visit("/reports")
    cy.contains("Transaction Log", { timeout: 15000 })
      .closest("[data-slot=card]")
      .contains("View Report")
      .click()
    cy.url().should("include", "/transactions")
  })

  it("report card descriptions are visible", () => {
    cy.visit("/reports")
    cy.contains("Active loans with days remaining", { timeout: 15000 }).should("be.visible")
    cy.contains("Monthly income and expense summary").should("be.visible")
    cy.contains("Assets, liabilities, and equity").should("be.visible")
    cy.contains("Full audit trail").should("be.visible")
  })
})
