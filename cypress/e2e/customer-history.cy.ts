describe("Customer Loan History", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "History Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer
    cy.visit("/customers/new")
    cy.get("#fullName").type("History Customer")
    cy.get("#contact").type("0771000020")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
    })
  })

  it("shows empty state when customer has no loans", () => {
    cy.contains("No loans on record for this customer.").should("be.visible")
  })

  it("shows all loans on customer profile page", () => {
    // Issue a loan
    cy.visit(`/loans/new?customerId=${customerId}`)
    cy.get("#principalAmount").type("1000000")
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Land Title").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

    // Should show the Loan History section with a loan card
    cy.contains("Loan History").should("be.visible")
    cy.contains("LOAN-").should("be.visible")
    cy.contains("UGX 1,000,000").should("be.visible")
    cy.contains("10% per month").should("be.visible")
    cy.contains("Active").should("be.visible")
  })

  it("expands loan card to show payment details", () => {
    // Issue a loan first
    cy.visit(`/loans/new?customerId=${customerId}`)
    cy.get("#principalAmount").type("500000")
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Land Title").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

    // Click expand button on the loan card
    cy.get("button[aria-label='Expand']").first().click()

    // Should show payment section (empty for new loan)
    cy.contains("No payments recorded.").should("be.visible")
  })

  it("shows loan status badge", () => {
    // Issue a loan
    cy.visit(`/loans/new?customerId=${customerId}`)
    cy.get("#principalAmount").type("750000")
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Vehicle Log Book").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

    // Active loan should show Active badge
    cy.contains("Active").should("be.visible")
    // Should show issue date
    cy.contains("Issued").should("be.visible")
  })

  it("collapse button works after expanding", () => {
    // Issue a loan first
    cy.visit(`/loans/new?customerId=${customerId}`)
    cy.get("#principalAmount").type("500000")
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").click()
    cy.get("[role=option]").contains("Land Title").click()
    cy.get("[data-base-ui-inert]").should("not.exist")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

    // Expand
    cy.get("button[aria-label='Expand']").first().click()
    cy.contains("No payments recorded.").should("be.visible")

    // Collapse
    cy.get("button[aria-label='Collapse']").first().click()
    cy.contains("No payments recorded.").should("not.exist")
  })
})
