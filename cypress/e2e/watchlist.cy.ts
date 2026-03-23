describe("Borrower Watchlist", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Watchlist Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows watchlist page with heading", () => {
    cy.visit("/watchlist")
    cy.contains("Watchlist", { timeout: 15000 }).should("be.visible")
  })

  it("shows empty state when all borrowers are current", () => {
    cy.visit("/watchlist")
    cy.contains("All borrowers are current.", { timeout: 15000 }).should("be.visible")
    cy.contains("No borrowers have exceeded the 30-day threshold").should("be.visible")
  })

  it("watchlist page loads after loan creation", () => {
    // Create a customer and issue a loan (freshly issued, not yet overdue)
    cy.visit("/customers/new")
    cy.get("#fullName").type("Watchlist Borrower")
    cy.get("#contact").type("0771000060")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

    cy.url().then((url) => {
      const cid = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${cid}`)
      cy.get("#principalAmount").type("500000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").type("Land Title")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)
    })

    // Visit watchlist — page should load without errors
    cy.visit("/watchlist")
    cy.contains("Watchlist", { timeout: 15000 }).should("be.visible")
  })

  it("navigates to watchlist from sidebar/navigation", () => {
    cy.contains("a", "Watchlist").click()
    cy.url().should("include", "/watchlist")
    cy.contains("Watchlist", { timeout: 15000 }).should("be.visible")
  })
})
