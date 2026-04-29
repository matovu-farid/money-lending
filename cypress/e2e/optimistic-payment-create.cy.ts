describe("Optimistic Payment Recording", () => {
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")

    // Create test user via API (avoids flaky UI registration + re-login)
    cy.createTestUser({ name: "Loan Officer", role: "superAdmin" }).then(
      (user: any) => {
        // Seed customer and loan directly in the DB — reliable and fast
        cy.task("db:seedCustomerAndLoan", {
          customerName: "Payment Borrower",
          contact: "0771000002",
          nin: "C1234567890123",
          principalAmount: "500000",
          issuedBy: user.userId,
        }).then((result: any) => {
          loanId = result.loanId
        })
      }
    )
  })

  it("instantly shows receipt and navigates back to loan detail after payment", () => {
    // Navigate to the payment form
    cy.visit(`/loans/${loanId}/payments/new`)

    // Wait for the form to load
    cy.contains("Record Payment", { timeout: 15000 }).should("be.visible")
    cy.get("#amount").should("be.visible")

    // Fill amount — MoneyInput strips non-numeric, so type raw digits
    cy.get("#amount").type("100000")

    // Payment date defaults to today, deposit location defaults to cash — leave as-is

    // Submit the form
    cy.contains("button", "Record Payment").click()

    // Confirmation dialog appears
    cy.contains("Confirm Payment", { timeout: 5000 }).should("be.visible")
    cy.contains("100,000").should("be.visible")
    cy.contains("button", "Confirm & Record").click()

    // POS Receipt modal should appear (optimistic — instant)
    cy.contains("KAKS CREDIT", { timeout: 10000 }).should("be.visible")

    // Close receipt — should navigate back to loan detail page
    cy.contains("button", "Close").click()
    cy.url({ timeout: 10000 }).should("match", new RegExp(`/loans/${loanId}$`))
  })

  it("rolls back payment when server action fails", () => {
    // Navigate to the payment form
    cy.visit(`/loans/${loanId}/payments/new`)
    cy.contains("Record Payment", { timeout: 15000 }).should("be.visible")
    cy.get("#amount").should("be.visible")

    // Fill amount
    cy.get("#amount").type("200000")

    // Set up intercept right before submit to avoid breaking page load
    cy.intercept("POST", "**", (req) => {
      if (req.headers["next-action"]) {
        req.reply({ statusCode: 500, body: "Internal Server Error" })
      }
    }).as("failedPayment")

    // Submit
    cy.contains("button", "Record Payment").click()

    // Confirm
    cy.contains("Confirm Payment", { timeout: 5000 }).should("be.visible")
    cy.contains("button", "Confirm & Record").click()

    // Receipt appears optimistically
    cy.contains("KAKS CREDIT", { timeout: 10000 }).should("be.visible")
    cy.contains("button", "Close").click()

    // After server failure, we should end up on the loan detail page
    cy.url({ timeout: 10000 }).should("include", "/loans/")

    // Verify the payment does not persist in the database
    cy.task("db:getPayments").then((payments: any) => {
      const loanPayments = payments.filter(
        (p: any) => p.loan_id === loanId && p.amount === "200000" && p.deleted_at === null
      )
      expect(loanPayments.length).to.equal(0)
    })
  })
})
