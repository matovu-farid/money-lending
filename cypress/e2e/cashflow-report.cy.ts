describe("Monthly Cashflow report", () => {
  beforeEach(() => {
    cy.clearCookies()
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Admin User" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("links from the reports landing page and renders the monthly cashflow table", () => {
    cy.visit("/reports")
    cy.contains("Monthly Cashflow", { timeout: 10000 }).should("be.visible")
    cy.contains("Monthly Cashflow")
      .closest("[data-slot='card']")
      .within(() => {
        cy.contains("View Report").click()
      })
    cy.url({ timeout: 5000 }).should("include", "/reports/cashflow")
    cy.contains("h1", "Cashflow").should("be.visible")
    cy.get("[data-testid='cashflow-report']", { timeout: 10000 }).should("exist")
  })

  it("shows the totals and a row for every month (12 months default)", () => {
    cy.visit("/reports/cashflow")
    // Toolbar period control is rendered by ReportToolbar.
    cy.get("[data-testid='cashflow-report']", { timeout: 10000 }).should("exist")
    cy.contains("Total Inflows").should("be.visible")
    cy.contains("Total Outflows").should("be.visible")
    cy.contains("Net").should("be.visible")
    // 12 month rows regardless of data.
    cy.get("[data-testid='data-row']").should("have.length", 12)
  })

  it("reflects manual income and expense entries in the inflow/outflow breakdown", () => {
    cy.visit("/income")
    cy.contains("button", /Record Income|Add Income/i).click()
    cy.get('input[name="categoryName"]').type("Test Inflow Category")
    cy.get('input[name="amount"]').type("750000")
    cy.contains("button", /Record|Save/i).last().click()
    cy.contains(/recorded|saved/i, { timeout: 10000 }).should("be.visible")

    cy.visit("/reports/cashflow")
    cy.contains("Income: Test Inflow Category", { timeout: 15000 }).should("be.visible")
  })
})
