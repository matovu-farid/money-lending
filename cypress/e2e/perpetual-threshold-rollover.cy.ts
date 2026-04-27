/**
 * E2E tests for the perpetual loan threshold check with rollover support.
 *
 * The threshold (PERPETUAL_LOAN_MIN_AMOUNT = 2,000,000 UGX) must consider
 * the carried rollover amount (outstandingPrincipal + accruedInterest) when
 * a customer has an active loan being rolled over into a new one.
 */

const PERPETUAL_RADIO = "input[name='loanType'][value='perpetual']"

let ninCounter = 0
/**
 * NIN format must match /^[CA][MF]\d{8}[A-Z0-9]{4}$/ (see customer-form-fields.tsx).
 * Tests share a TanStack DB replica that survives `cy.task("db:reset")`, so each
 * NIN must be unique across all runs in the session — derive it from Date.now()
 * plus a counter to guarantee no collisions.
 */
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

function issueInitialLoan(customerId: string, principal: string): void {
  cy.visit(`/loans/new?customerId=${customerId}`)
  cy.get("#principalAmount").type(principal)
  cy.get("#issuanceFee").type("50000")
  cy.contains("button", "Next").click()

  // Step 2: Collateral
  cy.get("#collateralNature").type("Land Title")
  cy.contains("button", "Next").click()

  // Step 3: Issue
  cy.contains("button", "Issue Loan").click()
  cy.dismissReceiptModal()
}

describe("Perpetual loan threshold — rollover-aware", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")
    // The TanStack DB client caches Electric shape offsets in localStorage and
    // IndexedDB. After `db:reset` the server's row offsets reset but the cached
    // offsets do not — that leaves Electric long-polling on a stale offset and
    // the form's `tx.isPersisted.promise` never resolves. Clear browser
    // storage so each test starts from offset=-1.
    cy.clearLocalStorage()
    cy.window().then((win) => {
      if (win.indexedDB) {
        win.indexedDB.databases?.().then((dbs) => {
          for (const db of dbs ?? []) {
            if (db.name) win.indexedDB.deleteDatabase(db.name)
          }
        })
      }
    })
    cy.registerAndLogin({ name: "Threshold Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  describe("No active loan (regression)", () => {
    beforeEach(() => {
      registerCustomer("Threshold Borrower", "0771300001").then((id) => {
        customerId = id
      })
    })

    it("hides Perpetual when entered principal is below 2,000,000 UGX", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.contains("Loan Details")
      cy.get("#principalAmount").type("1500000")

      cy.get(PERPETUAL_RADIO).should("not.exist")
      cy.contains("Perpetual loans require a minimum of 2,000,000 UGX").should("be.visible")
    })

    it("shows Perpetual when entered principal is at or above 2,000,000 UGX", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.contains("Loan Details")
      cy.get("#principalAmount").type("2000000")

      cy.get(PERPETUAL_RADIO).should("exist")
      cy.get(PERPETUAL_RADIO).should("be.checked")
    })
  })

  describe("Active loan present (rollover)", () => {
    it("shows Perpetual when entered + carried >= 2,000,000 UGX even though entered alone is less", () => {
      // Carried >= 1.5M (loan principal). Even with zero accrued interest the
      // effective amount is 1.5M + 1M = 2.5M, comfortably above the threshold.
      registerCustomer("Rollover Threshold Borrower A", "0771300002").then((id) => {
        customerId = id
        issueInitialLoan(customerId, "1500000")

        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")

        cy.get("#principalAmount").type("1000000")

        // Without the fix: 1,000,000 < 2,000,000 -> Perpetual hidden.
        // With the fix: 1,000,000 + 1,500,000 (+ accrued) >= 2,500,000 -> Perpetual visible.
        cy.get(PERPETUAL_RADIO).should("exist")
      })
    })

    it("hides Perpetual when entered + carried is still below 2,000,000 UGX", () => {
      // Initial loan principal 200k. Even with the minimum-period interest
      // accrual on top, 200k carried + 500k entered stays well below 2M.
      registerCustomer("Rollover Threshold Borrower B", "0771300003").then((id) => {
        customerId = id
        issueInitialLoan(customerId, "200000")

        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")

        cy.get("#principalAmount").type("500000")

        cy.get(PERPETUAL_RADIO).should("not.exist")
        cy.contains("Perpetual loans require an effective principal").should("be.visible")
      })
    })

    it("does not show any threshold hint while the principal field is empty", () => {
      registerCustomer("Rollover Threshold Borrower C", "0771300004").then((id) => {
        customerId = id
        issueInitialLoan(customerId, "200000")

        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")

        // Field empty: no hint should be shown (matches existing UX of
        // hiding the hint until the user types something).
        cy.contains("Perpetual loans require").should("not.exist")
      })
    })

    it("keeps Perpetual visible when rolling over a perpetual loan even with a small fresh entry", () => {
      // Regression guard: old loan was perpetual (>= 2M), so the form prefills
      // loanType=perpetual. With a small fresh entry the entered amount alone
      // is < 2M but the effective amount remains >= 2M and Perpetual must stay
      // in the rendered options for the prefilled selection to be reflected.
      registerCustomer("Rollover Threshold Borrower D", "0771300005").then((id) => {
        customerId = id
        issueInitialLoan(customerId, "2000000")

        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")

        cy.get("#principalAmount").type("100000")

        cy.get(PERPETUAL_RADIO).should("exist")
        cy.get(PERPETUAL_RADIO).should("be.checked")
      })
    })
  })
})
