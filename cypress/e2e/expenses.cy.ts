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

  it("records a new expense by typing a new category and submitting", () => {
    cy.visit("/expenses");
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click();

    cy.pickDate("#expense-date", "2026-03-21");
    // Type a brand-new category and submit — it should be auto-created
    cy.get("#expense-category").type("Office Supplies");
    cy.get("#expense-amount").type("50000");
    cy.get("#expense-notes").type("Printer paper and ink");
    cy.contains("button", "Record Expense").click();

    cy.contains('Created category "Office Supplies"', { timeout: 10000 }).should("be.visible");
    cy.contains("50,000", { timeout: 10000 }).should("be.visible");
    cy.contains("Office Supplies").should("be.visible");
  });

  it("creates and selects a category when pressing Enter on the input", () => {
    cy.visit("/expenses");
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click();

    cy.pickDate("#expense-date", "2026-03-21");
    cy.get("#expense-category").type("Transport{enter}");
    cy.contains('Created category "Transport"', { timeout: 10000 }).should("be.visible");
    // After Enter, the input shows the new selection (no spinner stuck)
    cy.get("#expense-category").should("have.value", "Transport");

    cy.get("#expense-amount").type("15000");
    cy.contains("button", "Record Expense").click();
    cy.contains("15,000", { timeout: 10000 }).should("be.visible");
    cy.contains("Transport").should("be.visible");
  });

  it("reuses an existing category when retyping the same name", () => {
    cy.visit("/expenses");
    // Create the category once
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click();
    cy.pickDate("#expense-date", "2026-03-21");
    cy.get("#expense-category").type("Utilities{enter}");
    cy.get("#expense-amount").type("10000");
    cy.contains("button", "Record Expense").click();
    cy.contains("Utilities", { timeout: 10000 }).should("be.visible");

    // Open again and pick the existing one via dropdown — no second create
    cy.contains("button", "Add Expense").click();
    cy.pickDate("#expense-date", "2026-03-21");
    cy.get("#expense-category").type("Util");
    cy.contains("button", "Utilities").click();
    cy.get("#expense-amount").type("20000");
    cy.contains("button", "Record Expense").click();
    cy.contains("20,000", { timeout: 10000 }).should("be.visible");
    // Only one "Created category" toast should ever have appeared
    cy.contains('Created category "Utilities"').should("not.exist");
  });

  it("disables add button while mutation is pending", () => {
    // Intercept server action POST and delay the response so we can observe pending state
    cy.intercept("POST", "/expenses", (req) => {
      if (req.headers["next-action"]) {
        req.on("response", (res) => { res.setDelay(1500) })
      }
    }).as("saveExpense")

    cy.visit("/expenses")
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click()
    cy.pickDate("#expense-date", "2026-03-21")
    cy.get("#expense-category").type("Test Category{enter}")
    cy.get("#expense-amount").type("10000")

    // Click submit
    cy.contains("button", "Record Expense").click()

    // While the server action is in flight, button should show "Saving..." and be disabled
    cy.contains("button", "Saving...").should("be.disabled")

    // Wait for the request to complete
    cy.wait("@saveExpense")
  })

  it("can delete an expense", () => {
    // First create an expense
    cy.visit("/expenses");
    cy.contains("button", "Add Expense", { timeout: 15000 })
      .scrollIntoView()
      .click();
    cy.pickDate("#expense-date", "2026-03-21");
    cy.get("#expense-category").type("Transport{enter}");
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

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844);
    });

    it("renders page at mobile and shows tab bar", () => {
      cy.visit("/expenses");
      cy.get("h1").should("be.visible");
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex");
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible");
    });

    it("Add Expense opens as drawer at mobile", () => {
      cy.visit("/expenses");
      cy.contains("button", "Add Expense", { timeout: 15000 })
        .scrollIntoView()
        .click({ force: true });
      cy.get('[data-slot="drawer-dialog-content"]', { timeout: 5000 }).should("be.visible");
    });
  });
});
