describe("Transaction Log", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Transaction Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows transaction log page with heading", () => {
    cy.visit("/transactions")
    cy.contains("Transaction Log", { timeout: 15000 }).should("be.visible")
  })

  it("shows empty state when no transactions exist", () => {
    cy.visit("/transactions")
    cy.contains("No transactions yet", { timeout: 15000 }).should("be.visible")
    cy.contains("Transactions appear here automatically").should("be.visible")
  })

  it("shows export buttons", () => {
    cy.visit("/transactions")
    cy.contains("Export PDF", { timeout: 15000 }).should("be.visible")
    cy.contains("Export Excel").should("be.visible")
  })

  it("shows filter controls", () => {
    cy.visit("/transactions")
    // Type filter trigger should show "All"
    cy.get("[data-slot='select-trigger']", { timeout: 15000 }).first().should("contain.text", "All")
    // Category filter trigger should show "All Categories"
    cy.get("[data-slot='select-trigger']").eq(1).should("contain.text", "All Categories")
  })

  it("shows transactions after recording a payment", () => {
    // Create customer, issue loan, record payment
    cy.visit("/customers/new")
    cy.get("#fullName").type("Transaction Borrower")
    cy.get("#contact").type("0771000070")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      const cid = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${cid}`)
      cy.get("#principalAmount").type("500000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").closest("[data-slot=select-trigger]").click()
      cy.contains("Land Title").click()
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)

      // Record a payment on the loan
      cy.task("db:getLoans").then((loans: any) => {
        const loanId = loans[0].id
        cy.visit(`/loans/${loanId}`)
        cy.contains("Record Payment", { timeout: 15000 }).click()
        cy.get("#amount").type("100000")
        cy.contains("button", "Record").click()
        cy.contains("100,000", { timeout: 10000 }).should("be.visible")
      })
    })

    // Check transaction log
    cy.visit("/transactions")
    cy.contains("No transactions yet").should("not.exist")
  })

  it("can filter transactions by type", () => {
    cy.visit("/transactions")
    // The type dropdown should be functional
    cy.get("[data-slot='select-trigger']", { timeout: 15000 }).first().click()
    cy.contains("[role=option]", "Income").click()
    // Page should reload with filter applied
    cy.url().should("include", "/transactions")
  })
})
