/**
 * Rolled-over loans must leave the operational watchlist while remaining
 * reachable as historical records from the successor loan detail page.
 */

let ninCounter = 0
function freshNin(): string {
  const t = Date.now() + ninCounter++
  const digits = (t % 100000000).toString().padStart(8, "0")
  const suffix = (t % 10000).toString().padStart(4, "0")
  return `CM${digits}${suffix}`
}

function registerCustomer(name: string, contact: string): Cypress.Chainable<string> {
  cy.visit("/customers/new")
  cy.get("#fullName").type(name)
  cy.get("#nin").type(freshNin())
  cy.get("#contact").type(contact)
  cy.get("#address").type("Kampala, Uganda")
  cy.contains("button", "Register Customer").click()
  cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)
  return cy.url().then((url) => url.split("/customers/")[1])
}

function issueLoan(customerId: string, principal: string): void {
  cy.visit(`/loans/new?customerId=${customerId}`)
  cy.get("#principalAmount").type(principal)
  cy.get("#issuanceFee").type("50000")
  cy.contains("button", "Next").click()
  cy.get("#collateralNature").type("Land Title")
  cy.contains("button", "Next").click()
  cy.contains("button", "Issue Loan").click()
  cy.dismissReceiptModal()
}

describe("Rollover loan visibility", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.registerAndLogin({ name: "Rollover Visibility Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows only the successor on /loans and links history from detail", () => {
    registerCustomer("Visibility Borrower", "0771999001").then((customerId) => {
      issueLoan(customerId, "2000000")

      cy.task("db:getLoans").then((loans: any[]) => {
        const predecessorId = loans.find((l) => l.status === "active")?.id
        expect(predecessorId).to.be.a("string")

        // Roll into a new loan
        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")
        cy.get("#principalAmount").type("500000")
        cy.get("#issuanceFee").type("25000")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Land Title")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.dismissReceiptModal()

        cy.task("db:getLoans").then((after: any[]) => {
          const successor = after.find(
            (l) => l.status === "active" && l.rolledOverFrom === predecessorId,
          )
          const predecessor = after.find((l) => l.id === predecessorId)
          expect(successor).to.exist
          expect(predecessor?.status).to.eq("rolled_over")

          // Watchlist: only one row for this customer (the successor)
          cy.visit("/loans")
          cy.contains("Visibility Borrower", { timeout: 15000 }).should("be.visible")
          cy.contains("Visibility Borrower").should("have.length", 1)

          // Successor detail shows history banner
          cy.visit(`/loans/${successor.id}`)
          cy.contains("rolled over from a previous loan", { timeout: 15000 }).should(
            "be.visible",
          )
          cy.contains("button", "View loan history").click()
          cy.contains("Loan history").should("be.visible")
          cy.contains("LOAN-").should("be.visible")

          // Predecessor remains reachable (read-only)
          cy.visit(`/loans/${predecessorId}`)
          cy.contains("rolled into a new loan", { timeout: 15000 }).should("be.visible")
          cy.contains("Record Payment").should("not.exist")

          // Payment deep link on predecessor is rejected
          cy.visit(`/loans/${predecessorId}/payments/new`)
          cy.contains("not active", { timeout: 15000 }).should("be.visible")
        })
      })
    })
  })
})
