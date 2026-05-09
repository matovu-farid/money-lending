describe("Optimistic Rollback", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Rollback Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("reverts optimistic expense row when server returns error", () => {
    cy.visit("/expenses")
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click()

    // Create a category first (this needs to succeed)
    cy.contains("+ Add Category").click()
    cy.get("#new-category-name").type("Doomed Category")
    cy.contains("button", "Add").click()

    // Now intercept the next server action POST to fail
    cy.intercept("POST", "/expenses", (req) => {
      if (req.headers["next-action"]) {
        req.reply({ statusCode: 500, body: "Internal Server Error" })
      }
    }).as("failedSave")

    cy.pickDate("#expense-date", "2026-03-21")
    cy.get("#expense-amount").type("99999")
    cy.contains("button", "Record Expense").click()

    // Optimistic row should appear briefly then revert
    // After error, toast should show failure message
    cy.contains("Failed to record expense", { timeout: 10000 }).should("be.visible")

    // The optimistic row should be gone — empty state should return
    cy.contains("No expenses recorded", { timeout: 10000 }).should("be.visible")
  })

  it("reverts optimistic income row when server returns error", () => {
    cy.visit("/income")
    cy.contains("button", "Add Income", { timeout: 15000 })
      .scrollIntoView()
      .click()

    // Create a category first
    cy.contains("+ Add Category").click()
    cy.get("#new-income-category-name").type("Doomed Income Cat")
    cy.contains("button", "Add").click()

    // Intercept server action to fail
    cy.intercept("POST", "/income", (req) => {
      if (req.headers["next-action"]) {
        req.reply({ statusCode: 500, body: "Internal Server Error" })
      }
    }).as("failedSave")

    cy.pickDate("#income-date", "2026-03-21")
    cy.get("#income-amount").type("99999")
    cy.contains("button", "Record Income").click()

    // Error toast should appear
    cy.contains("Failed to record income", { timeout: 10000 }).should("be.visible")

    // Optimistic row reverted — empty state returns
    cy.contains("No income recorded", { timeout: 10000 }).should("be.visible")
  })

  it("reverts optimistic expense delete when server returns error", () => {
    // First create a real expense
    cy.visit("/expenses")
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click()
    cy.pickDate("#expense-date", "2026-03-21")
    cy.contains("+ Add Category").click()
    cy.get("#new-category-name").type("Keep This")
    cy.contains("button", "Add").click()
    cy.get("#expense-amount").type("50000")
    cy.contains("button", "Record Expense").click()
    cy.contains("50,000", { timeout: 10000 }).should("be.visible")

    // Now intercept the delete server action to fail
    cy.intercept("POST", "/expenses", (req) => {
      if (req.headers["next-action"]) {
        req.reply({ statusCode: 500, body: "Internal Server Error" })
      }
    }).as("failedDelete")

    // Attempt to delete
    cy.contains("button", "Delete").first().click()
    cy.contains("Delete expense?").should("be.visible")
    cy.contains("button", "Delete expense").click()

    // Error toast should appear
    cy.contains("Failed to delete expense", { timeout: 10000 }).should("be.visible")

    // Row should reappear after rollback
    cy.contains("50,000", { timeout: 10000 }).should("be.visible")
  })

  it("reverts optimistic income delete when server returns error", () => {
    // First create a real income entry
    cy.visit("/income")
    cy.contains("button", "Add Income", { timeout: 15000 })
      .scrollIntoView()
      .click()
    cy.pickDate("#income-date", "2026-03-21")
    cy.contains("+ Add Category").click()
    cy.get("#new-income-category-name").type("Keep This")
    cy.contains("button", "Add").click()
    cy.get("#income-amount").type("75000")
    cy.contains("button", "Record Income").click()
    cy.contains("75,000", { timeout: 10000 }).should("be.visible")

    // Intercept delete server action to fail
    cy.intercept("POST", "/income", (req) => {
      if (req.headers["next-action"]) {
        req.reply({ statusCode: 500, body: "Internal Server Error" })
      }
    }).as("failedDelete")

    // Attempt to delete
    cy.contains("button", "Delete").first().click()
    cy.contains("Delete income entry?").should("be.visible")
    cy.contains("button", "Delete entry").click()

    // Error toast should appear
    cy.contains("Failed to delete income", { timeout: 10000 }).should("be.visible")

    // Row should reappear after rollback
    cy.contains("75,000", { timeout: 10000 }).should("be.visible")
  })
})
