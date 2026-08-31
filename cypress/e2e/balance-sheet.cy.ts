describe("Balance Sheet", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.registerAndLogin({ name: "Balance Sheet Admin" }).then((email) => {
      cy.task("db:promoteUser", { email, role: "superAdmin" })
      cy.clearCookies()
      cy.login(email, "TestPass123!")
    })
  })

  it("does not show an imbalance warning when the displayed totals balance", () => {
    cy.visit("/reports/balance-sheet")
    cy.contains("Total Assets", { timeout: 15000 }).should("exist")
    cy.contains("Total Liabilities & Equity").should("exist")
    cy.contains("Balance sheet does not balance").should("not.exist")
  })
})
