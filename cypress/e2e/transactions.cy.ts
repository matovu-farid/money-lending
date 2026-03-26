describe("Transaction Log", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Transaction Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows transaction log page with heading", () => {
    cy.visit("/transactions")
    cy.contains("Transactions", { timeout: 15000 }).should("be.visible")
    cy.contains("Complete transaction history").should("be.visible")
  })

  it("shows empty state when no transactions exist", () => {
    cy.visit("/transactions")
    cy.contains("No transactions yet", { timeout: 15000 }).should("be.visible")
    cy.contains("Transactions appear here automatically").should("be.visible")
  })

  it("shows export buttons", () => {
    cy.visit("/transactions")
    cy.contains("Export PDF", { timeout: 15000 }).should("be.visible")
    cy.contains("Export Excel").should("be.visible")
  })

  it("shows filter controls", () => {
    cy.visit("/transactions")
    // Both filter triggers should be visible
    cy.get("[data-slot='select-trigger']", { timeout: 15000 }).should("have.length.gte", 2)
    // Type filter shows "All" and category filter shows "All Categories"
    // Both use SelectValue placeholders which render inside the trigger
    cy.get("[data-slot='select-trigger']").first().invoke("text").should("match", /all/i)
    cy.get("[data-slot='select-trigger']").last().invoke("text").should("match", /all/i)
  })

  it("shows transactions after recording an expense", () => {
    // Record an expense — this always creates a debit transaction
    cy.visit("/expenses")
    cy.contains("button", "Add Expense", { timeout: 15000 }).scrollIntoView().click({ force: true })
    cy.get("#expense-date").type("2026-03-21")
    cy.contains("+ Add Category").click()
    cy.get("#new-category-name").type("Office Rent")
    cy.contains("button", /^Add$/).click()
    cy.get("[data-slot=select-trigger]").first().click({ force: true })
    cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
    cy.contains("[data-slot=select-item]", "Office Rent").realClick()
    cy.get("#expense-amount").type("200000")
    cy.get("#expense-notes").type("Monthly office rent")
    cy.contains("button", "Record Expense").click()
    cy.contains("200,000", { timeout: 10000 }).should("be.visible")

    // Check transaction log
    cy.visit("/transactions")
    cy.contains("No transactions yet", { timeout: 5000 }).should("not.exist")
    cy.contains("200,000", { timeout: 10000 }).should("exist")
  })

  it("can filter transactions by type", () => {
    cy.visit("/transactions")
    // The type dropdown should be functional
    cy.get("[data-slot='select-trigger']", { timeout: 15000 }).first().click()
    cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
    cy.contains("[data-slot=select-item]", "Income").realClick()
    // Verify the filter was applied — the select trigger should reflect the chosen value
    cy.get("[data-slot='select-trigger']").first().invoke("text").should("match", /income/i)
    cy.url().should("include", "/transactions")
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders transactions page at mobile with tab bar", () => {
      cy.visit("/transactions")
      cy.contains("Transactions", { timeout: 15000 }).should("be.visible")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })
  })
})
