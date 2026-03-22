describe("Expense CRUD", () => {
  beforeEach(() => {
    cy.task("db:reset");
    cy.registerAndLogin({ name: "Expense Admin" });
    cy.url({ timeout: 15000 }).should("include", "/dashboard");
  });

  it("shows expenses page with heading", () => {
    cy.visit("/expenses");
    cy.contains("Expenses", { timeout: 15000 }).should("be.visible");
  });

  it("shows empty state when no expenses recorded", () => {
    cy.visit("/expenses");
    cy.contains("No expenses recorded", { timeout: 15000 }).should(
      "be.visible",
    );
    cy.contains("Record your first expense").should("be.visible");
  });

  it("shows Add Expense button", () => {
    cy.visit("/expenses");
    cy.contains("Add Expense", { timeout: 15000 }).should("be.visible");
  });

  it("opens expense form sheet when clicking Add Expense", () => {
    cy.visit("/expenses");
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click();

    // Form fields should be visible in the sheet
    cy.get("#expense-date").should("be.visible");
    cy.get("#expense-amount").should("be.visible");
    cy.get("#expense-notes").should("be.visible");
  });

  it("records a new expense successfully", () => {
    cy.visit("/expenses");
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click();

    // Fill in the expense form
    cy.get("#expense-date").type("2026-03-21");
    // Select or create a category
    cy.contains("+ Add Category").click();
    cy.get("#new-category-name").type("Office Supplies");
    cy.contains("button", "Add").click();

    cy.get("#expense-amount").type("50000");
    cy.get("#expense-notes").type("Printer paper and ink");
    cy.contains("button", "Record Expense").click();

    // Should see the expense in the table
    cy.contains("50,000", { timeout: 10000 }).should("be.visible");
    cy.contains("Office Supplies").should("be.visible");
  });

  it.skip("disables add button while mutation is pending", () => {
    // Fill in expense form
    cy.visit("/expenses")
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click()
    cy.get("#expense-date").type("2026-03-21")
    cy.contains("+ Add Category").click()
    cy.get("#new-category-name").type("Test Category")
    cy.contains("button", "Add").click()
    cy.get("#expense-amount").type("10000")
    // Click submit
    cy.contains("button", "Record Expense").click()
    // Assert button has disabled attribute
    cy.contains("button", "Record Expense").should("be.disabled")
    // Assert Loader2 spinner is visible
    cy.get("[data-testid='spinner']").should("be.visible")
  })

  it("can delete an expense", () => {
    // First create an expense
    cy.visit("/expenses");
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click();
    cy.get("#expense-date").type("2026-03-21");
    cy.contains("+ Add Category").click();
    cy.get("#new-category-name").type("Transport");
    cy.contains("button", "Add").click();
    cy.get("#expense-amount").type("30000");
    cy.get("#expense-notes").type("Fuel for site visits");
    cy.contains("button", "Record Expense").click();
    cy.contains("30,000", { timeout: 10000 }).should("be.visible");

    // Delete the expense
    cy.contains("button", "Delete").first().click();
    cy.contains("Delete expense?").should("be.visible");
    cy.contains("button", "Delete expense").click();

    // Expense should be removed
    cy.contains("No expenses recorded", { timeout: 10000 }).should(
      "be.visible",
    );
  });
});
