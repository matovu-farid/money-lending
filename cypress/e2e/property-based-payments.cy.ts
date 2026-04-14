import fc from "fast-check"

// ─── Generated Test Data ────────────────────────────────────────

// Pre-generate random payment amounts for property-based E2E testing
const paymentAmounts = fc.sample(
  fc.integer({ min: 1000, max: 200000 }),
  5
)

// Pre-generate random sequences of multiple payments
const paymentSequences = fc.sample(
  fc.array(
    fc.integer({ min: 5000, max: 100000 }),
    { minLength: 2, maxLength: 4 }
  ),
  3
)

describe("Property-Based: Payment Recording", () => {
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "PBT Payment Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create customer and loan for testing
    cy.visit("/customers/new")
    cy.get("#fullName").type("PBT Borrower")
    cy.get("#contact").type("0771000099")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      const customerId = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.get("#principalAmount").type("1000000")
      cy.get("#issuanceFee").type("0")
      cy.get("#description").type("PBT test loan")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").click()
      cy.get("[role=option]").contains("Land Title").click()
      cy.get("[data-base-ui-inert]").should("not.exist")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      // Close the POS receipt modal
      cy.contains("SOVEREIGN LEDGER", { timeout: 10000 }).should("be.visible")
      cy.contains("button", "Close").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

      cy.task("db:getLoans").then((loans: any) => {
        loanId = loans[0].id
      })
    })
  })

  // ─── Property 1: Any valid payment amount is accepted ──────────
  paymentAmounts.forEach((amount, i) => {
    it(`accepts random valid payment amount: ${amount.toLocaleString()} UGX [case ${i}]`, () => {
      cy.then(() => {
        cy.visit(`/loans/${loanId}`)
        cy.contains("Record Payment", { timeout: 15000 }).click()
        cy.get("#amount").should("be.visible")
        cy.get("#amount").type(String(amount))
        cy.contains("button", "Record Payment").click()
        cy.dismissReceiptModal()

        // Payment should appear in history
        cy.contains(amount.toLocaleString("en-UG")).should("exist")
      })
    })
  })

  // ─── Property 2: Multiple sequential payments don't break UI ───
  paymentSequences.forEach((amounts, i) => {
    it(`handles sequential payment sequence [case ${i}]: ${amounts.join(", ")}`, () => {
      cy.then(() => {
        // Record each payment in sequence
        amounts.forEach((amount) => {
          cy.visit(`/loans/${loanId}`)
          cy.contains("Record Payment", { timeout: 15000 }).click()
          cy.get("#amount").should("be.visible")
          cy.get("#amount").type(String(amount))
          cy.contains("button", "Record Payment").click()
          cy.dismissReceiptModal()
        })

        // After all payments, loan detail page should still render correctly
        cy.visit(`/loans/${loanId}`)
        cy.get("table", { timeout: 15000 }).should("be.visible")
        // Should show all payments
        cy.get("table tbody tr").should("have.length.gte", amounts.length)
      })
    })
  })

  // ─── Property 3: Zero and negative amounts are rejected ────────
  it("rejects zero payment amount", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Record Payment", { timeout: 15000 }).click()
      cy.get("#amount").should("be.visible")
      cy.get("#amount").type("0")
      cy.contains("button", "Record Payment").click()
      // Should show error, not success
      cy.get("[role=alert], .text-destructive, [data-sonner-toast][data-type=error]", { timeout: 5000 })
        .should("exist")
    })
  })

  // ─── Property 4: Formatted amounts display correctly ───────────
  it("displays payment amounts with correct UGX formatting", () => {
    const amount = 150000
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Record Payment", { timeout: 15000 }).click()
      cy.get("#amount").should("be.visible")
      cy.get("#amount").type(String(amount))
      cy.contains("button", "Record Payment").click()
      cy.dismissReceiptModal()

      // Verify formatted display includes commas
      cy.contains("150,000").should("exist")
    })
  })

  // ─── Property 5: Overpayment beyond total owed is rejected ─────
  it("rejects overpayment exceeding total owed", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Record Payment", { timeout: 15000 }).click()
      cy.get("#amount").should("be.visible")
      // Pay way more than total owed (10x principal + interest)
      cy.get("#amount").type("10000000")
      cy.contains("button", "Record Payment").click()
      // Should show error about overpayment
      cy.get("[role=alert], .text-destructive, [data-sonner-toast][data-type=error]", { timeout: 5000 })
        .should("exist")
    })
  })
})
