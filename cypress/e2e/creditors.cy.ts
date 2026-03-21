describe("Creditors", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Admin User" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows the creditors list page with system capital KPIs", () => {
    cy.visit("/creditors")
    cy.contains("Creditors").should("be.visible")
    cy.contains("Total Invested").should("be.visible")
  })

  it("shows empty state when no creditors exist", () => {
    cy.visit("/creditors")
    cy.contains("No creditors yet").should("be.visible")
    cy.contains("Register your first creditor to start tracking invested capital.").should("be.visible")
  })

  it("can navigate to the add creditor form", () => {
    cy.visit("/creditors")
    cy.contains("Add Creditor").click()
    cy.url().should("include", "/creditors/new")
  })

  it("can register a new creditor with initial investment", () => {
    cy.visit("/creditors/new")
    cy.get('input[name="name"]').type("Test Creditor")
    cy.get('input[name="contact"]').type("0700000000")
    cy.get('input[name="address"]').type("Kampala, Uganda")
    cy.get('input[name="amount"]').type("5000000")
    cy.get('input[name="interestRateMonthly"]').clear().type("10")
    cy.contains("button", "Add Creditor").click()
    cy.url({ timeout: 10000 }).should("include", "/creditors")
    cy.contains("Test Creditor").should("be.visible")
  })

  it("shows validation errors for empty required fields", () => {
    cy.visit("/creditors/new")
    cy.contains("button", "Add Creditor").click()
    cy.contains("Name is required").should("be.visible")
    cy.contains("Contact is required").should("be.visible")
    cy.contains("Address is required").should("be.visible")
  })

  it("can view creditor profile with KPI dashboard", () => {
    // Register a creditor first
    cy.visit("/creditors/new")
    cy.get('input[name="name"]').type("Dashboard Creditor")
    cy.get('input[name="contact"]').type("0711111111")
    cy.get('input[name="address"]').type("Entebbe, Uganda")
    cy.get('input[name="amount"]').type("10000000")
    cy.get('input[name="interestRateMonthly"]').clear().type("5")
    cy.contains("button", "Add Creditor").click()
    cy.url({ timeout: 10000 }).should("include", "/creditors")

    // View the creditor profile
    cy.contains("View").first().click()
    cy.url({ timeout: 5000 }).should("match", /\/creditors\/.+/)

    // KPI cards should be visible
    cy.contains("Total Invested").should("be.visible")
    cy.contains("Outstanding Balance").should("be.visible")

    // Tabs should be visible
    cy.contains("Investments").should("be.visible")
    cy.contains("Repayments").should("be.visible")
  })
})
