describe("Loan Issuance Wizard", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")

    // Register as superAdmin
    cy.registerAndLogin({ name: "Loan Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer to issue loans to
    cy.visit("/customers/new")
    cy.get("#fullName").type("Borrower One")
    cy.get("#contact").type("0771000000")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    // Extract customer ID from URL
    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
    })
  })

  it("navigates through all 3 wizard steps", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    // Step 1: Loan Details
    cy.contains("Step 1 of 3")
    cy.contains("Loan Details")
    cy.get("#principalAmount").type("1000000")
    // Start date should default to today
    cy.get("#startDate").should("not.have.value", "")
    // Interest rate defaults to 10
    cy.get("#interestRate").should("have.value", "10")
    cy.contains("button", "Next").click()

    // Step 2: Collateral
    cy.contains("Step 2 of 3")
    cy.contains("Collateral")
    // Select collateral nature
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Land Title").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.get("#collateralDescription").type("Plot 42, Nakawa Division")
    cy.contains("button", "Next").click()

    // Step 3: Review & Confirm
    cy.contains("Step 3 of 3")
    cy.contains("Review & Confirm")
  })

  it("shows interest calculation preview on Step 3", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    // Step 1
    cy.get("#principalAmount").type("1000000")
    cy.contains("button", "Next").click()

    // Step 2
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Land Title").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.contains("button", "Next").click()

    // Step 3 — verify interest preview
    cy.contains("Interest Calculation Preview")
    cy.contains("Daily interest amount")
    cy.contains("Total interest at minimum period")
    cy.contains("Total owed at minimum period")

    // Math check: 1,000,000 at 10%/month
    // Daily = 1,000,000 * 0.10 / 30 = 3,333.33
    cy.contains("3,333.33")
    // 30-day interest = 1,000,000 * 0.10 = 100,000.00
    cy.contains("100,000")
    // Total owed = 1,000,000 + 100,000 = 1,100,000.00
    cy.contains("1,100,000")

    // Minimum interest period reminder
    cy.contains("Minimum interest period applies even if repaid early")
  })

  it("issues a loan and redirects to customer profile", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    // Step 1
    cy.get("#principalAmount").type("500000")
    cy.contains("button", "Next").click()

    // Step 2
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Vehicle Log Book").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.contains("button", "Next").click()

    // Step 3 — submit
    cy.contains("button", "Issue Loan").click()

    // Should redirect to customer profile with success
    cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)
  })

  it("validates Step 1 fields", () => {
    cy.visit("/loans/new")

    // Try advancing with empty fields
    cy.contains("button", "Next").click()

    cy.contains("Customer is required")
    cy.contains("Amount must be greater than 0")
  })

  it("validates Step 2 collateral nature is required", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    // Step 1
    cy.get("#principalAmount").type("500000")
    cy.contains("button", "Next").click()

    // Step 2 — try Next without selecting nature
    cy.contains("button", "Next").click()
    cy.contains("Collateral nature is required")
  })

  it("Back buttons navigate between steps correctly", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    // Step 1 → Step 2
    cy.get("#principalAmount").type("500000")
    cy.contains("button", "Next").click()
    cy.contains("Step 2 of 3")

    // Step 2 → Step 1
    cy.contains("button", "Back").click()
    cy.contains("Step 1 of 3")
    // Amount should be preserved
    cy.get("#principalAmount").should("have.value", "500000")

    // Go forward to Step 3
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Land Title").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.contains("button", "Next").click()
    cy.contains("Step 3 of 3")

    // Step 3 → Step 2
    cy.contains("button", "Back").click()
    cy.contains("Step 2 of 3")
  })

  it("pre-fills customer name when customerId is in URL", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    // Customer field should show name, not ID
    cy.get("#customerId").should("have.value", "Borrower One")
    cy.get("#customerId").should("be.disabled")
  })
})
