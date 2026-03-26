describe("Recent Activity Feed", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Activity Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  function selectCollateral() {
    cy.get("#collateralNature").type("Land Title")
  }

  function issueLoan(principalAmount: string) {
    cy.get("#principalAmount").type(principalAmount)
    cy.contains("button", "Next").click()
    selectCollateral()
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
  }

  it("shows clean description after issuing a loan", () => {
    cy.visit("/customers/new")
    cy.get("#fullName").type("Jane Mukasa")
    cy.get("#contact").type("0771000010")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

    cy.url().then((url) => {
      const cid = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${cid}`)
      issueLoan("1000000")
      cy.url({ timeout: 15000 }).should("include", `/customers/${cid}`)

      cy.visit("/dashboard")
      cy.contains("Loan disbursed", { timeout: 10000 }).should("be.visible")
      cy.contains("Jane Mukasa").should("be.visible")
      cy.contains("loan loan.create").should("not.exist")
    })
  })

  it("expands activity item to show details on click", () => {
    cy.visit("/customers/new")
    cy.get("#fullName").type("Detail Borrower")
    cy.get("#contact").type("0771000011")
    cy.get("#address").type("Jinja, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

    cy.url().then((url) => {
      const cid = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${cid}`)
      issueLoan("500000")
      cy.url({ timeout: 15000 }).should("include", `/customers/${cid}`)

      cy.visit("/dashboard")
      cy.contains("Loan disbursed", { timeout: 10000 }).should("be.visible")

      cy.contains("Interest Rate").should("not.exist")
      cy.contains("Loan disbursed").closest("button").click()
      cy.contains("Interest Rate").should("exist")
      cy.contains("Collateral").should("exist")
      cy.contains("Loan disbursed").closest("button").click()
      cy.contains("Interest Rate").should("not.exist")
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders activity feed section at mobile", () => {
      cy.visit("/dashboard")
      cy.contains("Recent Activity", { timeout: 10000 }).should("be.visible")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })
  })
})
