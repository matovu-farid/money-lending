describe("Loans List", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Loan Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows empty state when no loans exist", () => {
    cy.visit("/loans")
    cy.contains("No loans issued yet")
  })

  it("shows New Loan button", () => {
    cy.visit("/loans")
    cy.contains("New Loan").should("be.visible")
    cy.contains("New Loan").click()
    cy.url().should("include", "/loans/new")
  })

  it("displays issued loan in table after creation", () => {
    // Create customer first
    cy.visit("/customers/new")
    cy.get("#fullName").type("Loans List Customer")
    cy.get("#contact").type("0700111222")
    cy.get("#address").type("Gulu, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    // Extract customerId and issue loan
    cy.url().then((url) => {
      const cid = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${cid}`)

      cy.get("#principalAmount").type("2000000")
      cy.contains("button", "Next").click()

      cy.get("#collateralNature").click()
      cy.get("[role=option]").contains("Land Title").click()
      cy.get("[data-base-ui-inert]").should("not.exist")
      cy.contains("button", "Next").click()

      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)

      // Now check loans list
      cy.visit("/loans")
      cy.contains("2,000,000")
      cy.contains("10%")
    })
  })
})
