/**
 * Regression: soft-deleted loans must be invisible across the UI.
 *
 * The Electric shape syncs every row from `loans` and `payments`, including
 * those with `deleted_at` set. Without an `isNull(deletedAt)` filter at the
 * TanStack DB query layer, a user navigating directly to /loans/<deleted-id>
 * would see the loan-detail page rendered against a wiped ledger — phantom
 * "100% repaid", reversed payments still in the history. This spec locks
 * that behavior down at every surface the bug report covered.
 */

// Make this a module under isolatedModules so top-level `let ninCounter` does
// not collide with the identically-named local in perpetual-threshold-rollover.cy.ts.
export {}

// 14-char alphanumeric NIN, unique per call. NIN must match /^[A-Z0-9]{14}$/.
let ninCounter = 0
function nextNin(): string {
  ninCounter += 1
  return ("CF" + Date.now().toString(36).toUpperCase() + ninCounter).slice(0, 14).padEnd(14, "0")
}

function createCustomerAndLoan(customerName: string, contact: string, amount: string) {
  cy.visit("/customers/new")
  cy.get("#fullName").type(customerName)
  cy.get("#nin").type(nextNin())
  cy.get("#contact").type(contact)
  cy.get("#address").type("Kampala, Uganda")
  cy.contains("button", "Register Customer").click()
  cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

  return cy.url().then((url) => {
    const cid = url.split("/customers/")[1]
    cy.visit(`/loans/new?customerId=${cid}`)
    cy.get("#principalAmount").type(amount)
    cy.get("#issuanceFee").type("50000")
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").type("Land Title")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.dismissReceiptModal()
    cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)
    return cy.wrap(cid)
  })
}

describe("Soft-deleted loans are invisible", () => {
  let loanId: string
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Soft Delete Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    createCustomerAndLoan("Wipe Test Borrower", "0771000099", "2000000").then((cid) => {
      customerId = cid as unknown as string
    })

    // Record a payment so we have a deleted-payment row to assert against
    cy.task("db:getLoans").then((loans: any) => {
      loanId = loans[0].id
      cy.visit(`/loans/${loanId}/payments/new`)
      cy.get("#amount", { timeout: 10000 }).type("300000")
      cy.contains("button", "Record Payment").click()
      cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}`)
      cy.contains("300,000", { timeout: 10000 }).should("exist")
    })
  })

  it("loan-detail page redirects to /loans when the loan is soft-deleted", () => {
    // Sanity check: page renders before soft-delete
    cy.visit(`/loans/${loanId}`)
    cy.contains("Wipe Test Borrower", { timeout: 15000 }).should("be.visible")

    // Soft-delete the loan (and its payments) directly in the DB
    cy.task("db:softDeleteLoan", { loanId })

    // Re-visiting the deep link must not render the loan. Existing not-found
    // UX in /loans/[loanId]/page.tsx toasts and redirects to /loans, which is
    // the "clean not-found" behavior the bug report asked for.
    cy.visit(`/loans/${loanId}`)
    cy.url({ timeout: 15000 }).should("match", /\/loans\/?$/)
    cy.contains("Loan not found", { timeout: 10000 }).should("be.visible")
    cy.contains("Wipe Test Borrower").should("not.exist")
  })

  it("payment-history table excludes soft-deleted payments (loan still visible)", () => {
    // Confirm payment row is initially visible on the loan-detail page
    cy.visit(`/loans/${loanId}`)
    cy.contains("Wipe Test Borrower", { timeout: 15000 }).should("be.visible")
    cy.contains("300,000", { timeout: 10000 }).should("exist")
    cy.get("[data-testid='data-row']").should("have.length", 1)

    // Soft-delete only the payment row. The loan itself stays live so we can
    // assert the table filter independently — the only thing that should
    // change is the Payment History row disappearing and the empty state
    // taking over.
    cy.task("db:getPayments").then((payments: any) => {
      const paymentId = payments[0].id
      cy.task("db:softDeletePayment", { paymentId })
    })

    cy.visit(`/loans/${loanId}`)
    cy.contains("Wipe Test Borrower", { timeout: 15000 }).should("be.visible")
    cy.contains("h2", "Payment History", { timeout: 10000 }).should("be.visible")
    // Row gone, empty state visible, amount no longer present
    cy.get("[data-testid='data-row']").should("have.length", 0)
    cy.contains("No payments recorded", { timeout: 10000 }).should("be.visible")
    cy.contains("300,000").should("not.exist")
  })

  it("payments/new sibling route fails closed for a soft-deleted loan", () => {
    cy.task("db:softDeleteLoan", { loanId })

    cy.visit(`/loans/${loanId}/payments/new`)
    // The page renders the existing "Loan not found." fallback rather than
    // letting the user record a payment against a wiped ledger.
    cy.contains("Loan not found", { timeout: 15000 }).should("be.visible")
  })

  it("loans list excludes soft-deleted loans", () => {
    // Customer + loan visible on the list before delete
    cy.visit("/loans")
    cy.contains("Wipe Test Borrower", { timeout: 15000 }).should("be.visible")

    cy.task("db:softDeleteLoan", { loanId })

    cy.visit("/loans")
    cy.contains("Wipe Test Borrower", { timeout: 15000 }).should("not.exist")
  })

  it("customer-detail page excludes soft-deleted loans from the customer's history", () => {
    // Customer's loan card visible before delete
    cy.visit(`/customers/${customerId}`)
    cy.contains("Wipe Test Borrower", { timeout: 15000 }).should("be.visible")
    cy.contains("LOAN-", { timeout: 10000 }).should("be.visible")

    cy.task("db:softDeleteLoan", { loanId })

    cy.visit(`/customers/${customerId}`)
    cy.contains("Wipe Test Borrower", { timeout: 15000 }).should("be.visible")
    cy.contains("LOAN-").should("not.exist")
  })
})
