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

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders page at mobile and shows tab bar", () => {
      cy.visit("/loans")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })

    it("shows card layout instead of table at mobile", () => {
      // Create a customer and issue a loan to have data
      cy.visit("/customers/new")
      cy.get("#fullName").type("Mobile Loan Customer")
      cy.get("#contact").type("0733333333")
      cy.get("#address").type("Kampala, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

      cy.url().then((url) => {
        const cid = url.split("/customers/")[1]
        cy.visit(`/loans/new?customerId=${cid}`)
        cy.get("#principalAmount").type("500000")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").click()
        cy.get("[role=option]").contains("Land Title").click()
        cy.get("[data-base-ui-inert]").should("not.exist")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)

        cy.visit("/loans")
        cy.get("[data-slot='table-container']").should("not.be.visible")
        cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
      })
    })
  })
})
