describe("Balance Sheet", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.createTestUser({ name: "Balance Sheet Admin", role: "superAdmin" }).then((user) => {
      cy.task("db:injectCapital", { amount: "520672006.99" })
      cy.task("db:seedBalanceRoundingCase")
      cy.loginAsTestUser((user as { _cookies: Array<{ name: string; value: string }> })._cookies)
    })
  })

  it("does not show an imbalance warning when the displayed totals balance", () => {
    cy.visit("/reports/balance-sheet")
    cy.contains("Total Assets", { timeout: 15000 }).should("exist")
    cy.contains("Total Liabilities & Equity").should("exist")
    cy.contains("Balance sheet does not balance").should("not.exist")
  })
})
