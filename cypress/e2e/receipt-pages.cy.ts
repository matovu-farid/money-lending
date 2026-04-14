/**
 * E2E tests for the direct-URL receipt pages:
 * - /receipts/disbursement/[loanId]
 * - /receipts/repayment/[paymentId]
 *
 * These are the printable full-page receipts (not the POS modals).
 */
describe("Receipt Pages (Direct URL)", () => {
  let customerId: string
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Receipt Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer
    cy.visit("/customers/new")
    cy.get("#fullName").type("Receipt Test Customer")
    cy.get("#contact").type("0771000088")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)
    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
    })

    // Create a loan
    cy.then(() => {
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.get("#principalAmount").type("1000000")
      cy.get("#issuanceFee").type("50000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").click()
      cy.get("[role=option]").contains("Land Title").click()
      cy.get("[data-base-ui-inert]").should("not.exist")
      cy.get("#collateralDescription").type("Plot 42, Nakawa")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.dismissReceiptModal()
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)
    })

    cy.task("db:getLoans").then((loans: any) => {
      loanId = loans[0].id
    })
  })

  describe("Disbursement Receipt (/receipts/disbursement/[loanId])", () => {
    it("renders the disbursement receipt with all sections", () => {
      cy.then(() => {
        cy.visit(`/receipts/disbursement/${loanId}`)

        // Header
        cy.contains("Sovereign Ledger", { timeout: 15000 }).should("be.visible")
        cy.contains("Loan Disbursement Receipt").should("be.visible")

        // Receipt number
        cy.contains("LOAN-").should("be.visible")

        // Customer Details section
        cy.contains("Customer Details").should("be.visible")
        cy.contains("Receipt Test Customer").should("be.visible")
        cy.contains("0771000088").should("be.visible")

        // Loan Details section
        cy.contains("Loan Details").should("be.visible")
        cy.contains("Loan Amount").should("be.visible")
        cy.contains("1,000,000").should("be.visible")
        cy.contains("Interest Rate").should("be.visible")
        cy.contains("Issuance Fee").should("be.visible")
        cy.contains("50,000").should("be.visible")

        // Collateral section
        cy.contains("Collateral").should("be.visible")
        cy.contains("Land Title").should("be.visible")

        // Officer section
        cy.contains("Officer").should("be.visible")
        cy.contains("Issued By").should("be.visible")

        // Signature lines
        cy.contains("Customer Signature").should("be.visible")
        cy.contains("Officer Signature").should("be.visible")

        // Footer
        cy.contains("Official Receipt").should("be.visible")
      })
    })

    it("shows print button", () => {
      cy.then(() => {
        cy.visit(`/receipts/disbursement/${loanId}`)
        cy.contains("button", "Print", { timeout: 15000 }).should("be.visible")
      })
    })

    it("shows not found for invalid loan ID", () => {
      cy.visit(`/receipts/disbursement/00000000-0000-0000-0000-000000000000`, {
        failOnStatusCode: false,
      })
      cy.contains("Loan not found", { timeout: 15000 }).should("be.visible")
    })
  })

  describe("Repayment Receipt (/receipts/repayment/[paymentId])", () => {
    let paymentId: string

    beforeEach(() => {
      // Record a payment on the loan
      cy.then(() => {
        cy.visit(`/loans/${loanId}/payments/new`)
        cy.get("#amount", { timeout: 10000 }).type("200000")
        cy.contains("button", "Record Payment").click()

        // Close the POS modal
        cy.contains("SOVEREIGN LEDGER", { timeout: 10000 }).should("be.visible")
        cy.contains("button", "Close").click()
        cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}`)
      })

      cy.task("db:getPayments").then((payments: any) => {
        paymentId = payments[0].id
      })
    })

    it("renders the repayment receipt with all sections", () => {
      cy.then(() => {
        cy.visit(`/receipts/repayment/${paymentId}`)

        // Header
        cy.contains("Sovereign Ledger", { timeout: 15000 }).should("be.visible")
        cy.contains("Payment Receipt").should("be.visible")

        // Receipt number
        cy.contains("PAY-").should("be.visible")

        // Customer Details section
        cy.contains("Customer Details").should("be.visible")
        cy.contains("Receipt Test Customer").should("be.visible")
        cy.contains("Loan Reference").should("be.visible")

        // Payment Breakdown section
        cy.contains("Payment Breakdown").should("be.visible")
        cy.contains("Amount Paid").should("be.visible")
        cy.contains("200,000").should("be.visible")
        cy.contains("Interest Portion").should("be.visible")
        cy.contains("Principal Portion").should("be.visible")

        // Balance section
        cy.contains("Balance").should("be.visible")
        cy.contains("Principal Balance").should("be.visible")

        // Officer section
        cy.contains("Officer").should("be.visible")
        cy.contains("Received By").should("be.visible")

        // Signature lines
        cy.contains("Customer Signature").should("be.visible")
        cy.contains("Officer Signature").should("be.visible")

        // Footer
        cy.contains("Official Receipt").should("be.visible")
      })
    })

    it("shows print button", () => {
      cy.then(() => {
        cy.visit(`/receipts/repayment/${paymentId}`)
        cy.contains("button", "Print", { timeout: 15000 }).should("be.visible")
      })
    })

    it("shows not found for invalid payment ID", () => {
      cy.visit(`/receipts/repayment/00000000-0000-0000-0000-000000000000`, {
        failOnStatusCode: false,
      })
      cy.contains("Payment not found", { timeout: 15000 }).should("be.visible")
    })
  })
})
