describe("Optimistic Loan Creation", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")

    // Register as superAdmin
    cy.registerAndLogin({ name: "Loan Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer to issue loans to
    cy.visit("/customers/new")
    cy.get("#fullName").type("Optimistic Borrower")
    cy.get("#contact").type("0771000001")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    // Extract customer ID from URL
    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
    })
  })

  function fillLoanWizard(amount = "500000") {
    // Step 1: Loan Details
    cy.contains("Step 1 of 3")
    cy.get("#principalAmount").clear().type(amount)
    // issuanceFee defaults to 50,000 — clear and re-type to ensure it's set
    cy.get("#issuanceFee").clear().type("50000")
    // Interest rate defaults to 10, start date defaults to today — leave as-is
    cy.contains("button", "Next").click()

    // Step 2: Collateral (combobox text input with autocomplete suggestions)
    cy.contains("Step 2 of 3")
    cy.get("#collateralNature").type("Land Title")
    // If a suggestion dropdown appears, pick it; otherwise the typed value is fine
    cy.get("body").then(($body) => {
      if ($body.find("[role=option]").length) {
        cy.get("[role=option]").contains("Land Title").first().click({ force: true })
      }
    })
    cy.get("#collateralDescription").type("Plot 42, Nakawa")
    cy.contains("button", "Next").click()

    // Step 3: Review & Confirm
    cy.contains("Step 3 of 3")
  }

  it("instantly navigates to loan detail page after creation", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    fillLoanWizard("1000000")

    // Submit
    cy.contains("button", "Issue Loan").click()

    // POS Receipt modal appears
    cy.contains("KAKS CREDIT", { timeout: 10000 }).should("be.visible")
    cy.contains("LOAN DISBURSEMENT").should("be.visible")

    // Close receipt — should navigate to /loans/{uuid}
    cy.contains("button", "Close").click()
    cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-f0-9-]+$/)
  })

  it("shows optimistic loan data in receipt modal", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    fillLoanWizard("750000")

    // Submit
    cy.contains("button", "Issue Loan").click()

    // Receipt modal should show the optimistic data immediately
    cy.contains("KAKS CREDIT", { timeout: 10000 }).should("be.visible")
    cy.contains("LOAN DISBURSEMENT").should("be.visible")
    // Receipt shows the principal amount
    cy.contains("750,000").should("be.visible")
    // Receipt shows collateral info
    cy.contains("Land Title").should("be.visible")
    // Receipt shows disbursement source
    cy.contains("Cash").should("be.visible")

    // Close receipt — should navigate away from /loans/new
    cy.contains("button", "Close").click()
    cy.url({ timeout: 15000 }).should("not.include", "/new")
    // Should be on a loan detail page or the loans list
    cy.url().should("include", "/loans")
  })

  it("rolls back optimistic data when server action fails", () => {
    cy.visit(`/loans/new?customerId=${customerId}`)

    // Intercept the server action POST on the loan detail page
    // The collection's onInsert fires a server action; intercept to simulate failure
    cy.intercept("POST", "**", (req) => {
      // Only intercept Next.js server action calls that happen AFTER form submission
      // The loan creation server action goes through the collection's onInsert
      if (req.headers["next-action"] && req.url.includes("/loans/")) {
        req.reply({ statusCode: 500, body: "Internal Server Error" })
      }
    }).as("failedCreate")

    fillLoanWizard("999999")

    // Submit
    cy.contains("button", "Issue Loan").click()

    // Receipt modal should still appear (optimistic)
    cy.contains("KAKS CREDIT", { timeout: 10000 }).should("be.visible")
    cy.contains("button", "Close").click()

    // After server failure, the loan should be rolled back from the collection.
    // The detail page should detect the loan is gone and redirect to /loans
    // or show a "Loan not found" toast.
    cy.url({ timeout: 15000 }).should("include", "/loans")

    // The error toast or "Loan not found" should appear
    cy.contains(/Loan not found|Failed|error/i, { timeout: 10000 }).should("be.visible")
  })
})
