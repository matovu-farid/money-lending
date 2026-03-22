describe("Optimistic Rollback", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Rollback Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it.skip("reverts optimistic expense row when server returns error", () => {
    // Stub the expense Server Action to return { error: "..." }
    // Add an expense
    // Assert the optimistic row appears
    // Assert the row disappears after error
    // Assert error toast is shown
  })

  it.skip("reverts optimistic income row when server returns error", () => {
    // Same pattern for income
  })

  it.skip("reverts optimistic expense delete when server returns error", () => {
    // Stub the delete expense Server Action to return { error: "..." }
    // Delete an expense row
    // Assert the row disappears optimistically
    // Assert the row reappears after error
    // Assert error toast is shown
  })

  it.skip("reverts optimistic income delete when server returns error", () => {
    // Same pattern for income
  })
})
