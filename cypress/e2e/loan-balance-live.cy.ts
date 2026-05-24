// cypress/e2e/loan-balance-live.cy.ts
//
// Verifies the projection-table pipeline: writes to `transactions` fire the
// `refresh_loan_balance` trigger, which upserts `loan_balances`, which Electric
// replicates to the client, which `useLoansWithBalances` joins into the UI.
//
// Strategy: seed a loan directly via Neon (which inserts a Loans Receivable
// debit and fires the trigger), then load the /loans list page and assert the
// projected balance + customer name appear in the row. This validates the
// read path end-to-end without depending on the UI payment flow.
//
import type {
  CreatedTestUser,
  DbLoanBalanceRow,
  DbSeedCustomerAndLoanResult,
} from "../support/types"

describe("Loan balance projection pipeline", () => {
  let loanId: string
  let cookies: Cypress.Cookie[]

  before(() => {
    cy.clearAllCookies()
    cy.clearAllLocalStorage()
    cy.clearAllSessionStorage()

    cy.createTestUser({ name: "Projection Tester", role: "superAdmin" }).then((user: CreatedTestUser) => {
      const nin = `CM${Date.now().toString().slice(-8)}LBP`
      cy.task<DbSeedCustomerAndLoanResult>("db:neon:seedCustomerAndLoan", {
        customerName: "Projection Test Borrower",
        contact: "0772111002",
        nin,
        principalAmount: "500000",
        issuedBy: user.userId,
      }).then((seed) => {
        loanId = seed.loanId
      })

      cy.getCookies().then((c) => {
        cookies = c
      })
    })
  })

  after(() => {
    cy.then(() => {
      if (loanId) cy.task("db:neon:cleanupTestLoan", { loanId })
    })
  })

  beforeEach(() => {
    cy.clearAllCookies()
    cy.then(() => {
      if (cookies) {
        for (const c of cookies) {
          cy.setCookie(c.name, c.value, {
            domain: c.domain || undefined,
            path: c.path || "/",
            httpOnly: true,
            secure: false,
          })
        }
      }
    })
  })

  it("populates loan_balances with the principal on Loans Receivable debit", () => {
    cy.task<DbLoanBalanceRow | null>("db:neon:getLoanBalance", { loanId }).then((balance) => {
      expect(balance, "loan_balances row should exist after seed").to.not.equal(null)
      expect(balance?.outstanding_balance).to.equal("500000.00")
      expect(balance?.unpaid_interest).to.equal("0.00")
    })
  })

  it("renders the projected outstanding balance in the loans list", () => {
    cy.visit("/loans")
    cy.contains("Projection Test Borrower", { timeout: 90000 }).should("exist")
    cy.contains("UGX 500,000", { timeout: 30000 }).should("exist")
  })

  it("updates loan_balances when a credit transaction is inserted, and the live UI reflects it", () => {
    cy.visit("/loans")
    cy.contains("Projection Test Borrower", { timeout: 90000 }).should("exist")
    cy.contains("UGX 500,000", { timeout: 30000 }).should("exist")

    cy.task("db:neon:postLoansReceivableCredit", { loanId, amount: "100000" })

    cy.task<DbLoanBalanceRow | null>("db:neon:getLoanBalance", { loanId }).then((balance) => {
      expect(balance?.outstanding_balance).to.equal("400000.00")
    })

    cy.contains("UGX 400,000", { timeout: 30000 }).should("exist")
  })
})
