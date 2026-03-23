describe("Quick-Record Payment Workflow", () => {
  let customerId: string
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Collection Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create customer
    cy.visit("/customers/new")
    cy.get("#fullName").type("Quick Record Borrower")
    cy.get("#contact").type("0771000099")
    cy.get("#address").type("Kampala")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]

      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.get("#principalAmount").type("500000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").type("Land Title")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

      cy.task("db:getLoans").then((loans: any) => {
        loanId = loans[0].id
      })
    })
  })

  it("Record Payment button is visible on payments page", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").should("be.visible")
  })

  it("opens quick-record dialog when button clicked", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")
    cy.get('[role="dialog"]').contains("Record Payment").should("be.visible")
    cy.get('input[placeholder="Search customer name..."]').should("be.visible")
  })

  it("searches active loans by customer name (QREC-01)", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    cy.get('input[placeholder="Search customer name..."]').type("Quick Record")
    cy.contains("Quick Record Borrower", { timeout: 10000 }).should("be.visible")
    cy.contains("LOAN-").should("be.visible")
  })

  it("selects loan from search results and enables amount field (QREC-01)", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    cy.get('input[placeholder="Search customer name..."]').type("Quick Record")
    cy.contains("Quick Record Borrower", { timeout: 10000 }).should("be.visible")
    cy.contains("Quick Record Borrower").click()

    // Amount input should now be enabled
    cy.get('input[type="number"]', { timeout: 5000 }).should("not.be.disabled")
  })

  it("submits payment and shows success with receipt link (QREC-01 + QREC-02)", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    // Search and select loan
    cy.get('input[placeholder="Search customer name..."]').type("Quick Record")
    cy.contains("Quick Record Borrower", { timeout: 10000 }).click()

    // Enter amount
    cy.get('input[type="number"]').should("not.be.disabled").type("50000")

    // Submit
    cy.get('[role="dialog"]').contains("button", "Record Payment").click()

    // Success state
    cy.contains("Payment Recorded", { timeout: 15000 }).should("be.visible")
    cy.contains("UGX 50,000").should("be.visible")

    // Receipt link
    cy.contains("View receipt")
      .should("have.attr", "href")
      .and("include", "/receipts/repayment/")
    cy.contains("View receipt").should("have.attr", "target", "_blank")
  })

  it("Record another resets form after success (QREC-01)", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    // Complete a payment
    cy.get('input[placeholder="Search customer name..."]').type("Quick Record")
    cy.contains("Quick Record Borrower", { timeout: 10000 }).click()
    cy.get('input[type="number"]').type("30000")
    cy.get('[role="dialog"]').contains("button", "Record Payment").click()
    cy.contains("Payment Recorded", { timeout: 15000 }).should("be.visible")

    // Click Record another
    cy.contains("button", "Record another").click()

    // Form should be reset
    cy.get('[role="dialog"]').contains("Record Payment").should("be.visible")
    cy.get('input[placeholder="Search customer name..."]').should("be.visible").and("have.value", "")
    cy.get('input[type="number"]').should("have.value", "")
  })

  it("recently-collected chips appear after recording (QREC-03)", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    // Record a payment
    cy.get('input[placeholder="Search customer name..."]').type("Quick Record")
    cy.contains("Quick Record Borrower", { timeout: 10000 }).click()
    cy.get('input[type="number"]').type("40000")
    cy.get('[role="dialog"]').contains("button", "Record Payment").click()
    cy.contains("Payment Recorded", { timeout: 15000 }).should("be.visible")

    // Close dialog
    cy.contains("button", "Close").click()
    cy.get('[role="dialog"]').should("not.exist")

    // Reopen dialog
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    // Recently-collected section should be visible
    cy.contains("Recent", { timeout: 5000 }).should("be.visible")
    cy.get('[role="dialog"]').contains("button", "Quick Record Borrower").should("be.visible")
  })

  it("clicking a recently-collected chip selects the loan (QREC-03)", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    // Record a payment first to populate chips
    cy.get('input[placeholder="Search customer name..."]').type("Quick Record")
    cy.contains("Quick Record Borrower", { timeout: 10000 }).click()
    cy.get('input[type="number"]').type("25000")
    cy.get('[role="dialog"]').contains("button", "Record Payment").click()
    cy.contains("Payment Recorded", { timeout: 15000 }).should("be.visible")

    // Close and reopen
    cy.contains("button", "Close").click()
    cy.get('[role="dialog"]').should("not.exist")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    // Click the chip
    cy.get('[role="dialog"]').contains("button", "Quick Record Borrower").click()

    // Amount field should be enabled (loan is selected)
    cy.get('input[type="number"]', { timeout: 5000 }).should("not.be.disabled")
  })

  it("search shows empty state for no matches", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    cy.get('input[placeholder="Search customer name..."]').type("NonexistentCustomerXYZ")
    cy.contains("No active loans found", { timeout: 10000 }).should("be.visible")
  })

  it("payments list refreshes after recording", () => {
    cy.visit("/payments")
    cy.contains("button", "Record Payment").first().click()
    cy.get('[role="dialog"]', { timeout: 5000 }).should("be.visible")

    // Record payment
    cy.get('input[placeholder="Search customer name..."]').type("Quick Record")
    cy.contains("Quick Record Borrower", { timeout: 10000 }).click()
    cy.get('input[type="number"]').type("60000")
    cy.get('[role="dialog"]').contains("button", "Record Payment").click()
    cy.contains("Payment Recorded", { timeout: 15000 }).should("be.visible")

    // Close dialog
    cy.contains("button", "Close").click()
    cy.get('[role="dialog"]').should("not.exist")

    // Payments list should show the new payment
    cy.contains("Quick Record Borrower", { timeout: 10000 }).should("be.visible")
  })
})
