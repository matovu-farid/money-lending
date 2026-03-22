describe("Payment Recording Flow", () => {
  let customerId: string
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Payment Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create customer and issue loan
    cy.visit("/customers/new")
    cy.get("#fullName").type("Payment Borrower")
    cy.get("#contact").type("0771000040")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]

      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.get("#principalAmount").type("1000000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").click()
      cy.get("[role=option]").contains("Land Title").click()
      cy.get("[data-base-ui-inert]").should("not.exist")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

      cy.task("db:getLoans").then((loans: any) => {
        loanId = loans[0].id
      })
    })
  })

  it("shows Record Payment button on loan detail page", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Record Payment", { timeout: 15000 }).should("be.visible")
    })
  })

  it("records a payment successfully", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Record Payment", { timeout: 15000 }).click()

      // Payment form should appear
      cy.get("#amount").should("be.visible")
      cy.get("#amount").type("200000")
      cy.contains("button", "Record").click()

      // Should see payment in the table
      cy.contains("200,000", { timeout: 10000 }).should("be.visible")
    })
  })

  it("shows empty payments state for new loan", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("No payments recorded", { timeout: 15000 }).should("be.visible")
    })
  })

  it("shows payment table headers after recording", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Record Payment", { timeout: 15000 }).click()
      cy.get("#amount").type("100000")
      cy.contains("button", "Record").click()

      // Payment table should have correct headers
      cy.contains("th", "Date", { timeout: 10000 }).should("be.visible")
      cy.contains("th", "Amount").should("be.visible")
    })
  })

  it("outstanding balance decreases after payment", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)

      // Note the initial outstanding balance
      cy.contains("Outstanding Balance", { timeout: 15000 }).should("be.visible")

      cy.contains("Record Payment").click()
      cy.get("#amount").type("500000")
      cy.contains("button", "Record").click()

      // After payment, balance should have changed
      cy.contains("500,000", { timeout: 10000 }).should("be.visible")
    })
  })
})
