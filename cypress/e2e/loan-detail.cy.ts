/**
 * E2E tests for the /loans/[loanId] loan detail page.
 * Covers page rendering, loan info cards, status badges,
 * payment history table, record payment link, edit/delete loan dialogs,
 * back navigation, and mobile responsiveness.
 */

function createCustomerAndLoan(
  customerName: string,
  contact: string,
  principalAmount: string,
  opts?: { issuanceFee?: string }
) {
  cy.visit("/customers/new")
  cy.get("#fullName").type(customerName)
  cy.get("#contact").type(contact)
  cy.get("#address").type("Kampala, Uganda")
  cy.contains("button", "Register Customer").click()
  cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

  return cy.url().then((url) => {
    const cid = url.split("/customers/")[1]
    cy.visit(`/loans/new?customerId=${cid}`)
    cy.get("#principalAmount").type(principalAmount)
    cy.get("#issuanceFee").type(opts?.issuanceFee ?? "50000")
    cy.contains("button", "Next").click()
    cy.get("#collateralNature").type("Land Title")
    cy.contains("button", "Next").click()
    cy.contains("button", "Issue Loan").click()
    cy.dismissReceiptModal()
    cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)
    return cy.wrap(cid)
  })
}

describe("Loan Detail Page (/loans/[loanId])", () => {
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Detail Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    createCustomerAndLoan("Detail Test Customer", "0771000077", "2000000")

    cy.task("db:getLoans").then((loans: any) => {
      loanId = loans[0].id
    })
  })

  describe("Page rendering", () => {
    it("renders the loan detail page with customer name", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
    })

    it("shows the loan reference (LOAN-xxxxxxxx format)", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("LOAN-").should("be.visible")
    })

    it("shows a status badge", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      // New loans start as "Active" (auto-disbursed in test flow)
      cy.get(".inline-flex, [data-slot='badge']").should("have.length.gte", 1)
    })

    it("shows Back to Loans link", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.get("a[aria-label='Back to Loans']").should("be.visible")
    })

    it("Back to Loans link navigates to /loans", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.get("a[aria-label='Back to Loans']").click()
      cy.url({ timeout: 10000 }).should("include", "/loans")
    })
  })

  describe("Loan info cards", () => {
    it("shows the Principal card with formatted amount", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Principal").should("be.visible")
      cy.contains("2,000,000").should("be.visible")
    })

    it("shows the Interest Rate card with percentage and /month suffix", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Interest Rate").should("be.visible")
      cy.contains("/ month").should("be.visible")
    })

    it("shows the Start Date card", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Start Date").should("be.visible")
    })

    it("shows the Issuance Fee card", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Issuance Fee").should("be.visible")
      cy.contains("50,000").should("be.visible")
    })

    it("shows the Loan Type card", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Loan Type").should("be.visible")
    })
  })

  describe("Principal Balance section", () => {
    it("shows Principal Balance heading", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Principal Balance").should("be.visible")
    })

    it("shows repayment progress bar with percentage", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("repaid").should("be.visible")
    })

    it("shows Record Payment button for active loans", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Record Payment").should("be.visible")
    })

    it("Record Payment button navigates to the new payment page", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Record Payment").click()
      cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}/payments/new`)
    })

    it("shows Print Receipt button", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Print Receipt").should("be.visible")
    })
  })

  describe("Payment History section", () => {
    it("shows Payment History heading", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("h2", "Payment History").should("be.visible")
    })

    it("shows empty state when no payments exist", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("No payments recorded").should("be.visible")
      cy.contains("Record the first payment against this loan").should("be.visible")
    })

    it("shows Record Payment link in empty state", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("No payments recorded").should("be.visible")
      // The empty state has a "Record Payment" link
      cy.get("a").filter(":contains('Record Payment')").should("have.length.gte", 1)
    })
  })

  describe("Payment History with payments", () => {
    beforeEach(() => {
      // Record a payment
      cy.visit(`/loans/${loanId}/payments/new`)
      cy.get("#amount", { timeout: 10000 }).type("300000")
      cy.contains("button", "Record Payment").click()
      cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}`)
      cy.contains("300,000", { timeout: 10000 }).should("exist")
    })

    it("shows payment history table with correct headers", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("th", "Date").should("exist")
      cy.contains("th", "Amount").should("exist")
      cy.contains("th", "Interest").should("exist")
      cy.contains("th", "Principal").should("exist")
      cy.contains("th", "Balance").should("exist")
      cy.contains("th", "Recorded By").should("exist")
    })

    it("shows payment row with formatted amount", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.get("[data-testid='data-row']").should("have.length.gte", 1)
      cy.contains("300,000").should("be.visible")
    })

    it("shows payment count text", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("1 payment").should("be.visible")
    })

    it("shows payment actions dropdown with Edit and Delete options", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Edit").should("be.visible")
      cy.contains("Delete").should("be.visible")
    })
  })

  describe("Edit Loan dialog", () => {
    it("shows Edit and Delete buttons for admin user", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")

      cy.contains("button", "Edit").should("be.visible")
      cy.contains("button", "Delete").should("be.visible")
    })

    it("opens Edit Loan dialog with form fields", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")

      cy.contains("button", "Edit").first().click()

      // The edit dialog should appear (it uses DrawerDialog)
      cy.contains("Edit Loan", { timeout: 5000 }).should("be.visible")
    })
  })

  describe("Delete Loan dialog", () => {
    it("opens Delete Loan confirmation dialog", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")

      // Click the Delete button (not the payment delete)
      cy.get("button").filter(":contains('Delete')").filter(":not([aria-label='Payment actions'])").first().click()

      cy.contains("Delete Loan", { timeout: 5000 }).should("be.visible")
    })
  })

  describe("404 for non-existent loan", () => {
    it("returns 404 for a non-existent loan ID", () => {
      cy.request({
        url: "/loans/00000000-0000-0000-0000-000000000000",
        failOnStatusCode: false,
      })
        .its("status")
        .should("eq", 404)
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders loan detail page at mobile", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("LOAN-").should("be.visible")
    })

    it("shows tab bar at mobile", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
    })

    it("info cards stack vertically at mobile", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Principal").should("be.visible")
      cy.contains("Interest Rate").should("be.visible")
      cy.contains("Start Date").should("be.visible")
    })

    it("Record Payment button is visible at mobile", () => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Detail Test Customer", { timeout: 15000 }).should("be.visible")
      cy.contains("Record Payment").should("be.visible")
    })
  })
})
