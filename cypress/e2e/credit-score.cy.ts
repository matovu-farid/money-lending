describe("Credit Score Badge", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Score Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer
    cy.visit("/customers/new")
    cy.get("#fullName").type("Score Customer")
    cy.get("#contact").type("0771000099")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
    })
  })

  describe("Customer Detail Page", () => {
    it("shows 'No loan history' for customer with no loans", () => {
      cy.contains("No loan history").should("be.visible")
    })

    it("shows credit score after a loan is issued", () => {
      // Issue a loan
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.get("#principalAmount").type("1000000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").click()
      cy.get("[role=option]").first().click()
      cy.get("[data-base-ui-inert]").should("not.exist")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

      // Should show a numeric score (300-850 range) or a label
      cy.get("body").then(($body) => {
        const text = $body.text()
        const hasScore = /\b[3-8]\d{2}\b/.test(text)
        const hasLabel = ["Excellent", "Very Good", "Good", "Fair", "Poor", "Very Poor"].some((l) =>
          text.includes(l),
        )
        expect(hasScore || hasLabel).to.be.true
      })
    })

    it("displays info popover with scoring factors", () => {
      // Click the info icon near the credit score area
      cy.get("[aria-label='More information']").first().click()

      // Popover should show scoring factors
      cy.contains("Repayment Timeliness (35%)").should("be.visible")
      cy.contains("Loan Completion (25%)").should("be.visible")
      cy.contains("Borrowing History (20%)").should("be.visible")
      cy.contains("Balance Paydown (10%)").should("be.visible")
      cy.contains("Penalty Record (10%)").should("be.visible")

      // Score ranges should be visible
      cy.contains("800–850: Excellent").should("be.visible")
      cy.contains("300–449: Very Poor").should("be.visible")
    })
  })

  describe("New Loan Form", () => {
    it("displays credit score when customer is pre-selected", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      // Badge should appear below customer name
      cy.contains("No loan history").should("be.visible")
    })
  })
})
