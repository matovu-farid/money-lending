import type { DbLoanRow } from "../support/types"

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
    cy.get("#issuanceFee").type("50000")
    cy.get("#description").type("Test loan for penalty")
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").type("Land Title")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.dismissReceiptModal()
    cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)
    return cy.wrap(cid)
  })
}

/** Backdate a loan's start date so it's 90 days overdue (with no payments, penalty triggers at 60+) */
function backdateLoan(loanId: string) {
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  cy.task("db:setLoanStartDate", { loanId, startDate: ninetyDaysAgo.toISOString() })
}

describe("Overdue Penalty", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Penalty Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows penalty badge on loans list when loan is 60+ days overdue", () => {
    createCustomerAndLoan("Penalty Customer", "0700100100", "1000000").then(() => {
      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        const loan = loans[0]
        expect(loan.penalty_waived).to.eq(false)

        // Backdate loan to make it 90 days overdue (penalty kicks in at 60+)
        backdateLoan(loan.id)

        cy.visit("/loans")
        cy.contains("Penalty Customer", { timeout: 10000 }).should("be.visible")
        cy.contains("Penalty").should("be.visible")
      })
    })
  })

  it("shows penalty details on loan detail page with effective rate", () => {
    createCustomerAndLoan("Detail Penalty", "0700200200", "500000").then(() => {
      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        const loan = loans[0]
        backdateLoan(loan.id)

        cy.visit(`/loans/${loan.id}`)
        cy.contains("Penalty Rate Active", { timeout: 10000 }).should("be.visible")
        // Default penalty: 10% of 10% rate = effective 11%
        cy.contains("Effective: 11.0%").should("be.visible")
      })
    })
  })

  it("admin can waive penalty", () => {
    createCustomerAndLoan("Waive Customer", "0700300300", "500000").then(() => {
      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        const loan = loans[0]
        backdateLoan(loan.id)

        cy.visit(`/loans/${loan.id}`)
        cy.contains("Penalty Rate Active", { timeout: 10000 }).should("be.visible")
        cy.contains("button", "Waive Penalty").should("be.visible").click()
        cy.contains("Penalty waived", { timeout: 5000 }).should("be.visible")
        // After waive, penalty should be gone and waived badge should show
        cy.contains("Penalty Rate Active").should("not.exist")
        cy.contains("Penalty Waived").should("be.visible")
      })
    })
  })

  it("admin can adjust penalty multiplier", () => {
    createCustomerAndLoan("Adjust Customer", "0700400400", "500000").then(() => {
      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        const loan = loans[0]
        backdateLoan(loan.id)

        cy.visit(`/loans/${loan.id}`)
        cy.contains("Penalty Rate Active", { timeout: 10000 }).should("be.visible")
        cy.contains("button", "Adjust Rate").click()
        cy.get('input[placeholder="%"]').clear().type("20")
        cy.contains("button", "Save").click()
        cy.contains("Penalty rate adjusted", { timeout: 5000 }).should("be.visible")
      })
    })
  })

  it("penalty with custom multiplier shows correct effective rate", () => {
    createCustomerAndLoan("Custom Multiplier", "0700500500", "500000").then(() => {
      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        const loan = loans[0]
        backdateLoan(loan.id)
        // Set 20% penalty multiplier
        cy.task("db:setPenaltyMultiplier", { loanId: loan.id, multiplier: "0.2000" })

        cy.visit(`/loans/${loan.id}`)
        cy.contains("Penalty Rate Active", { timeout: 10000 }).should("be.visible")
        // 10% + (10% * 20%) = 10% + 2% = 12%
        cy.contains("Effective: 12.0%").should("be.visible")
      })
    })
  })

  it("penalty does NOT show when loan is under 60 days overdue", () => {
    createCustomerAndLoan("Under Threshold", "0700600600", "500000").then(() => {
      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        const loan = loans[0]
        // Set start date to 45 days ago — overdue but under 60-day penalty threshold
        const fortyFiveDaysAgo = new Date()
        fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45)
        cy.task("db:setLoanStartDate", { loanId: loan.id, startDate: fortyFiveDaysAgo.toISOString() })

        cy.visit(`/loans/${loan.id}`)
        // Should NOT see penalty badge (overdue but under threshold)
        cy.contains("Penalty Rate Active").should("not.exist")
      })
    })
  })
})
