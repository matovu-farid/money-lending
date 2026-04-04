describe("POS Receipts", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Receipt Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer
    cy.visit("/customers/new")
    cy.get("#fullName").type("Receipt Borrower")
    cy.get("#contact").type("0771000099")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
    })
  })

  function fillLoanWizard() {
    cy.visit(`/loans/new?customerId=${customerId}`)

    // Step 1: Loan Details
    cy.get("#principalAmount").type("1000000")
    cy.get("#issuanceFee").type("50000")
    cy.get("#description").type("Working capital loan")
    cy.contains("button", "Next").click()

    // Step 2: Collateral
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Land Title").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.get("#collateralDescription").type("Plot 42, Nakawa")
    cy.contains("button", "Next").click()

    // Step 3: Review & Confirm
    cy.contains("button", "Issue Loan").click()
  }

  describe("Loan Disbursement Receipt", () => {
    it("shows POS receipt modal after successful loan creation", () => {
      fillLoanWizard()

      // Dialog should be visible with receipt content
      cy.contains("SOVEREIGN LEDGER", { timeout: 10000 }).should("be.visible")
      cy.contains("LOAN DISBURSEMENT").should("be.visible")

      // Receipt number should match pattern RCP-XXXXXXXX-XXXX
      cy.get(".pos-receipt").invoke("text").should("match", /RCP-\d{8}-[A-Z0-9]{4}/)

      // Customer name should be visible
      cy.contains("Receipt Borrower").should("be.visible")

      // Loan amount should be formatted
      cy.contains("1,000,000").should("be.visible")

      // Interest rate
      cy.contains("10%").should("be.visible")

      // Collateral
      cy.contains("Land Title").should("be.visible")

      // Issuance fee (from Plan 2)
      cy.contains("50,000").should("be.visible")

      // Description (from Plan 2)
      cy.contains("Working capital loan").should("be.visible")

      // Buttons
      cy.contains("button", "Print Receipt").should("be.visible")
      cy.contains("button", "Close").should("be.visible")
    })

    it("navigates to customer page after closing receipt modal", () => {
      fillLoanWizard()

      // Wait for modal
      cy.contains("SOVEREIGN LEDGER", { timeout: 10000 }).should("be.visible")

      // Close the modal
      cy.contains("button", "Close").click()

      // Should navigate to customer page
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)
    })

    it("print button exists and is clickable", () => {
      fillLoanWizard()

      // Wait for modal
      cy.contains("SOVEREIGN LEDGER", { timeout: 10000 }).should("be.visible")

      // Print button should be clickable (not disabled)
      cy.contains("button", "Print Receipt")
        .should("be.visible")
        .and("not.be.disabled")
    })
  })

  describe("Payment Receipt", () => {
    let loanId: string

    beforeEach(() => {
      // Issue a loan first
      fillLoanWizard()

      // Close the disbursement receipt modal
      cy.contains("SOVEREIGN LEDGER", { timeout: 10000 }).should("be.visible")
      cy.contains("button", "Close").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

      // Get the loan ID
      cy.task("db:getLoans").then((loans: any) => {
        loanId = loans[0].id
      })
    })

    it("shows POS receipt modal after successful payment recording", () => {
      cy.then(() => {
        cy.visit(`/loans/${loanId}/payments/new`)

        // Fill payment form
        cy.get("#amount", { timeout: 10000 }).type("200000")
        cy.contains("button", "Record Payment").click()

        // POS Receipt modal should appear
        cy.contains("SOVEREIGN LEDGER", { timeout: 10000 }).should("be.visible")
        cy.contains("PAYMENT RECEIPT").should("be.visible")

        // Receipt number
        cy.get(".pos-receipt").invoke("text").should("match", /RCP-\d{8}-[A-Z0-9]{4}/)

        // Payment details
        cy.contains("Receipt Borrower").should("be.visible")
        cy.contains("Amount Paid").should("be.visible")
        cy.contains("200,000").should("be.visible")
        cy.contains("Interest").should("be.visible")
        cy.contains("Principal").should("be.visible")
        cy.contains("Balance After").should("be.visible")

        // Buttons
        cy.contains("button", "Print Receipt").should("be.visible")
        cy.contains("button", "Close").should("be.visible")
      })
    })

    it("navigates to loan detail page after closing receipt modal", () => {
      cy.then(() => {
        cy.visit(`/loans/${loanId}/payments/new`)

        cy.get("#amount", { timeout: 10000 }).type("150000")
        cy.contains("button", "Record Payment").click()

        // Wait for modal
        cy.contains("SOVEREIGN LEDGER", { timeout: 10000 }).should("be.visible")

        // Close the modal
        cy.contains("button", "Close").click()

        // Should navigate to loan detail page
        cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}`)
      })
    })
  })
})
