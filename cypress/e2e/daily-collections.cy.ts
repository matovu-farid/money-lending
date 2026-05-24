import type { DbLoanRow } from "../support/types"

describe("Daily Collections Tab", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Collections Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  describe("Tab Navigation", () => {
    it("shows All Payments and Daily tabs on /payments page", () => {
      cy.visit("/payments")
      cy.contains("All Payments", { timeout: 15000 }).should("be.visible")
      cy.contains("Daily", { timeout: 15000 }).should("be.visible")
    })

    it("switches to Daily tab via URL param", () => {
      cy.visit("/payments?tab=daily")
      cy.get('[aria-label="Previous day"]', { timeout: 15000 }).should("be.visible")
    })

    it("switches between tabs by clicking", () => {
      cy.visit("/payments")
      // Click Daily tab — date navigation bar should appear
      cy.contains("Daily", { timeout: 15000 }).click()
      cy.get('[aria-label="Previous day"]', { timeout: 10000 }).should("be.visible")
      // Click All Payments tab — filter bar should appear
      cy.contains("All Payments").click()
      cy.contains("Search by customer name", { timeout: 10000 }).should("be.visible")
    })
  })

  describe("COLL-01: Summary Cards - empty state", () => {
    it("shows summary cards with zero values when no payments exist", () => {
      cy.visit("/payments?tab=daily")
      cy.contains("Total Collected", { timeout: 15000 }).should("be.visible")
      cy.contains("Payments", { timeout: 10000 }).should("be.visible")
      cy.contains("Average Payment", { timeout: 10000 }).should("be.visible")
      // With no payments, total should be 0
      cy.contains("UGX 0", { timeout: 10000 }).should("be.visible")
    })
  })

  describe("COLL-01 + COLL-02: Summary cards and breakdown with data", () => {
    let customerId: string

    beforeEach(() => {
      // Create customer and loan
      cy.visit("/customers/new")
      cy.get("#fullName").type("Daily Test Borrower")
      cy.get("#contact").type("0771234567")
      cy.get("#address").type("Kampala, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.url().then((url) => {
        customerId = url.split("/customers/")[1]

        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.get("#principalAmount").type("2000000")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Vehicle")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)
      })
    })

    it("shows total collected and payment count after recording a payment", () => {
      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        const loanId = loans[0].id
        cy.visit(`/loans/${loanId}/payments/new`)
        cy.get("#amount", { timeout: 10000 }).type("300000")
        cy.contains("button", "Record Payment").click()
        cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}`)

        cy.visit("/payments?tab=daily")
        cy.contains("Total Collected", { timeout: 15000 }).should("be.visible")
        // Total collected should contain the amount
        cy.contains("300,000", { timeout: 10000 }).should("be.visible")
        // Payments count should show 1
        cy.get(".grid").within(() => {
          cy.contains("1").should("be.visible")
        })
      })
    })

    it("shows per-loan breakdown row with customer name and amount", () => {
      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        const loanId = loans[0].id
        cy.visit(`/loans/${loanId}/payments/new`)
        cy.get("#amount", { timeout: 10000 }).type("250000")
        cy.contains("button", "Record Payment").click()
        cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}`)

        cy.visit("/payments?tab=daily")
        cy.contains("Collections on", { timeout: 15000 }).should("be.visible")
        // Breakdown table row should contain customer name
        cy.contains("Daily Test Borrower", { timeout: 10000 }).should("be.visible")
        // Amount formatted
        cy.contains("250,000", { timeout: 10000 }).should("be.visible")
      })
    })
  })

  describe("COLL-03: Date Navigation", () => {
    it("shows date navigation with prev/next buttons and calendar", () => {
      cy.visit("/payments?tab=daily")
      cy.get('[aria-label="Previous day"]', { timeout: 15000 }).should("be.visible")
      cy.get('[aria-label="Next day"]', { timeout: 15000 }).should("be.visible")
      // Date display button (popover trigger)
      cy.contains("Today", { timeout: 10000 }).should("be.visible")
    })

    it("next day button is disabled when viewing today", () => {
      cy.visit("/payments?tab=daily")
      cy.get('[aria-label="Next day"]', { timeout: 15000 }).should("be.disabled")
    })

    it("navigating to a specific date via URL shows correct date label", () => {
      // Visit with a specific past date directly
      cy.visit("/payments?tab=daily&date=2026-01-15")
      cy.get('[aria-label="Previous day"]', { timeout: 15000 }).should("be.visible")
      // With a past date (not today), "Today" should not appear in the date button
      cy.contains("Jan 15").should("exist")
    })

    it("date picker opens calendar popup", () => {
      cy.visit("/payments?tab=daily")
      // Click the date display button (shows "Today" text)
      cy.contains("Today", { timeout: 15000 }).click()
      // Calendar popup should appear with month navigation
      cy.get('[data-slot="calendar"]', { timeout: 10000 }).should("be.visible")
    })
  })

  describe("COLL-04: Due Today Section", () => {
    it("shows Due Today section heading", () => {
      cy.visit("/payments?tab=daily")
      cy.contains("Due Today", { timeout: 15000 }).should("be.visible")
    })

    it("shows subtitle text for due today section", () => {
      cy.visit("/payments?tab=daily")
      cy.contains("Active loans with no payment in 30 or more days", { timeout: 15000 }).should("exist")
    })

    it("shows all loans are up to date when no overdue loans", () => {
      // With fresh db and a brand new loan (startDate = now, < 30 days), no overdue loans
      cy.visit("/customers/new")
      cy.get("#fullName").type("Recent Borrower")
      cy.get("#contact").type("0771999888")
      cy.get("#address").type("Kampala, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.url().then((url) => {
        const cid = url.split("/customers/")[1]
        cy.visit(`/loans/new?customerId=${cid}`)
        cy.get("#principalAmount").type("500000")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Motorcycle")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)

        cy.visit("/payments?tab=daily")
        cy.contains("All loans are up to date", { timeout: 15000 }).should("exist")
      })
    })
  })

  describe("Empty States", () => {
    it("shows empty collections message for date with no payments", () => {
      cy.visit("/payments?tab=daily")
      cy.contains("No collections on this date", { timeout: 15000 }).should("be.visible")
    })

    it("shows empty body text for no collections", () => {
      cy.visit("/payments?tab=daily")
      cy.contains("No payments were recorded for", { timeout: 15000 }).should("be.visible")
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders daily collections page at mobile with tab bar", () => {
      cy.visit("/payments?tab=daily")
      cy.contains("Total Collected", { timeout: 15000 }).should("be.visible")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })
  })
})
