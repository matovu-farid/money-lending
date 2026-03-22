describe("Income CRUD", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Income Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows income page with heading", () => {
    cy.visit("/income")
    cy.contains("Income", { timeout: 15000 }).should("be.visible")
  })

  it("shows empty state when no income recorded", () => {
    cy.visit("/income")
    cy.contains("No income recorded", { timeout: 15000 }).should("be.visible")
    cy.contains("Record your first income entry").should("be.visible")
  })

  it("shows Add Income button", () => {
    cy.visit("/income")
    cy.contains("Add Income", { timeout: 15000 }).should("be.visible")
  })

  it("opens income form sheet when clicking Add Income", () => {
    cy.visit("/income")
    cy.contains("button", "Add Income", { timeout: 15000 })
      .scrollIntoView()
      .click()

    // Form fields should be visible
    cy.get("#income-date").should("be.visible")
    cy.get("#income-amount").should("be.visible")
    cy.get("#income-notes").should("be.visible")
  })

  it("records new income successfully", () => {
    cy.visit("/income")
    cy.contains("button", "Add Income", { timeout: 15000 })
      .scrollIntoView()
      .click()

    cy.get("#income-date").type("2026-03-21")
    // Create a category
    cy.contains("+ Add Category").click()
    cy.get("#new-income-category-name").type("Loan Interest")
    cy.contains("button", "Add").click()

    cy.get("#income-amount").type("150000")
    cy.get("#income-notes").type("Monthly interest collection")
    cy.contains("button", "Record Income").click()

    // Should see the income entry in the table
    cy.contains("150,000", { timeout: 10000 }).should("be.visible")
    cy.contains("Loan Interest").should("be.visible")
  })

  it("can delete an income entry", () => {
    // First create an income entry
    cy.visit("/income")
    cy.contains("button", "Add Income", { timeout: 15000 })
      .scrollIntoView()
      .click()
    cy.get("#income-date").type("2026-03-21")
    cy.contains("+ Add Category").click()
    cy.get("#new-income-category-name").type("Penalty Fees")
    cy.contains("button", "Add").click()
    cy.get("#income-amount").type("25000")
    cy.get("#income-notes").type("Late payment penalty")
    cy.contains("button", "Record Income").click()
    cy.contains("25,000", { timeout: 10000 }).should("be.visible")

    // Delete the entry
    cy.contains("button", "Delete").first().click()
    cy.contains("Delete income entry?").should("be.visible")
    cy.contains("button", "Delete entry").click()

    // Income should be removed
    cy.contains("No income recorded", { timeout: 10000 }).should("be.visible")
  })
})
