describe("Transaction recorder display", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.createTestUser({ name: "Transaction Recorder Admin", role: "superAdmin" }).then((user) => {
      cy.task("db:injectCapital", { amount: "1000000" })
      cy.loginAsTestUser((user as { _cookies: Array<{ name: string; value: string }> })._cookies)
    })
  })

  it("shows the recorder name instead of the stored user ID", () => {
    cy.visit("/transactions")
    cy.get("[data-testid='transaction-recorded-by']", { timeout: 10000 })
      .should("have.length.at.least", 2)
      .each(($recorder) => {
        expect($recorder.text()).to.equal("Transaction Recorder Admin")
      })
  })
})
