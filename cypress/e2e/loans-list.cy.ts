function createCustomerAndLoan(customerName: string, contact: string, amount: string) {
  cy.visit("/customers/new")
  cy.get("#fullName").type(customerName)
  cy.get("#contact").type(contact)
  cy.get("#address").type("Kampala, Uganda")
  cy.contains("button", "Register Customer").click()
  cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

  return cy.url().then((url) => {
    const cid = url.split("/customers/")[1]
    cy.visit(`/loans/new?customerId=${cid}`)
    cy.get("#principalAmount").type(amount)
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").type("Land Title")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)
    return cy.wrap(cid)
  })
}

describe("Loans List (Unified)", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Loan Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  context("empty state", () => {
    it("shows empty state when no loans exist", () => {
      cy.visit("/loans")
      cy.contains("h2", "No loans yet.", { timeout: 10000 }).should("be.visible")
      cy.contains("Issue a loan to get started.").should("be.visible")
      cy.contains("button", "New Loan").should("be.visible")
    })
  })

  context("with loan data", () => {
    beforeEach(() => {
      createCustomerAndLoan("Test Borrower", "0700000001", "1000000")
    })

    it("shows page heading and subtitle", () => {
      cy.visit("/loans")
      cy.get("h1", { timeout: 10000 }).contains("Loans").should("be.visible")
      cy.contains("All loans sorted by risk level").should("be.visible")
      cy.contains("Last calculated:").should("be.visible")
    })

    it("displays stat cards with correct labels", () => {
      cy.visit("/loans")
      cy.contains("Critical (30+ days)", { timeout: 10000 }).should("be.visible")
      cy.contains("At Risk (15-29 days)").should("be.visible")
      cy.contains("Early (1-14 days)").should("be.visible")
      cy.contains("Total Overdue").should("be.visible")
    })

    it("displays filter tabs with counts", () => {
      cy.visit("/loans")
      cy.contains("button", /^All \(/, { timeout: 10000 }).should("be.visible")
      cy.contains("button", /^Critical \(30\+\)/).should("be.visible")
      cy.contains("button", /^At Risk \(15-29\)/).should("be.visible")
      cy.contains("button", /^Early \(1-14\)/).should("be.visible")
    })

    it("clicking stat card activates matching filter", () => {
      cy.visit("/loans")
      cy.contains("Critical (30+ days)", { timeout: 10000 }).closest("button").click()
      // Stat card should have ring-2 class when active
      cy.contains("Critical (30+ days)").closest("button").should("have.class", "ring-2")
      // Filter tab for Critical should be active (default variant = solid background)
      cy.contains("button", /^Critical \(30\+\)/).should("not.have.attr", "data-state", "inactive")
    })

    it("New Loan button navigates to /loans/new", () => {
      cy.visit("/loans")
      cy.contains("button", "New Loan", { timeout: 10000 }).first().click()
      cy.url().should("include", "/loans/new")
    })

    it("Print button exists", () => {
      cy.visit("/loans")
      cy.contains("button", "Print", { timeout: 10000 }).should("be.visible")
    })

    it("table shows correct columns", () => {
      cy.viewport(1280, 900)
      cy.visit("/loans")
      cy.contains("Customer Name", { timeout: 10000 }).should("exist")
      cy.contains("Principal Amount").should("exist")
      cy.contains("Principal Balance").should("exist")
      cy.contains("Total Due").should("exist")
      cy.contains("Days Overdue").should("exist")
      cy.contains("Last Payment").should("exist")
    })

    it("shows filter empty state when no loans match", () => {
      cy.visit("/loans")
      // A fresh loan has 0 days overdue, so Critical filter should be empty
      cy.contains("button", /^Critical \(30\+\)/, { timeout: 10000 }).click()
      cy.contains("h2", "No loans in this category.", { timeout: 10000 }).should("be.visible")
      cy.contains("No loans match the selected filter. Try a different category.").should("be.visible")
      cy.contains("button", "Show all loans").should("be.visible")
      cy.contains("button", "Show all loans").click()
      cy.get("[data-testid='data-row']", { timeout: 10000 }).should("exist")
    })
  })

  context("navigation", () => {
    beforeEach(() => {
      createCustomerAndLoan("Nav Test Borrower", "0700000002", "500000")
    })

    it("row click navigates to loan detail", () => {
      cy.visit("/loans")
      cy.get("[data-testid='data-row']", { timeout: 10000 }).first().click()
      cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-zA-Z0-9-]+$/)
    })

    it("Customer Name link navigates to customer profile", () => {
      cy.visit("/loans")
      // Click the customer name link specifically (not the row)
      cy.get("[data-testid='data-row']", { timeout: 10000 }).first().within(() => {
        cy.get("a[href^='/customers/']").first().click()
      })
      cy.url({ timeout: 10000 }).should("match", /\/customers\//)
    })

    it("/watchlist returns 404 after deletion", () => {
      cy.request({ url: "/watchlist", failOnStatusCode: false })
        .its("status")
        .should("eq", 404)
    })

    it("sidebar shows Loans but not Watchlist", () => {
      cy.viewport(1280, 800)
      cy.visit("/loans")
      cy.get("[data-testid='sidebar-nav']", { timeout: 10000 }).should("be.visible")
      cy.get("[data-testid='sidebar-nav']").contains("Loans").should("be.visible")
      cy.get("[data-testid='sidebar-nav']").contains("Watchlist").should("not.exist")
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders card layout at mobile", () => {
      createCustomerAndLoan("Mobile Borrower", "0700000003", "750000")
      cy.visit("/loans")
      cy.get("[data-slot='table-container']", { timeout: 10000 }).should("not.be.visible")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
    })

    it("shows tab bar at mobile", () => {
      cy.visit("/loans")
      cy.get("[data-testid='bottom-tab-bar']", { timeout: 10000 }).should("exist")
        .and("have.css", "display", "flex")
    })
  })
})
