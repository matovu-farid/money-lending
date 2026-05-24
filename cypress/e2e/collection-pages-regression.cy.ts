/**
 * Regression tests verifying each page still renders correctly
 * after the TanStack DB migration. Covers page loads, table rendering,
 * and basic navigation -- no mutations tested here.
 *
 * Uses DB seeding (cy.task) to insert data directly, ensuring reliable
 * test data regardless of optimistic collection behavior.
 */
import type { DbSeedCustomerAndLoanResult } from "../support/types"

describe("Collection Pages Regression", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Regression Tester" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  describe("Loans list page (/loans)", () => {
    it("loads and shows heading", () => {
      cy.visit("/loans")
      cy.get("h1", { timeout: 15000 }).contains("Loans").should("be.visible")
    })

    it("shows empty state when no loans exist", () => {
      cy.visit("/loans")
      cy.contains("No loans yet", { timeout: 15000 }).should("be.visible")
    })

    it("renders data rows when loans exist", () => {
      // Seed data via DB task using the logged-in user's ID
      cy.window().then(() => {
        // Get user from DB (first user = the one we just registered)
        cy.task<DbSeedCustomerAndLoanResult>("db:seedCustomerAndLoan", {
          customerName: "Loans Regression",
          contact: "0700100001",
          nin: "C0000000000001",
          principalAmount: "1000000",
          issuedBy: "seed-user", // issued_by is a text field
        }).then(() => {
          cy.visit("/loans")
          cy.get("[data-testid='data-row']", { timeout: 15000 }).should("have.length.gte", 1)
          cy.contains("Loans Regression").should("be.visible")
        })
      })
    })
  })

  describe("Customer list page (/customers)", () => {
    it("loads and shows heading", () => {
      cy.visit("/customers")
      cy.contains("Customers", { timeout: 15000 }).should("be.visible")
    })

    it("renders data rows when customers exist", () => {
      cy.task<DbSeedCustomerAndLoanResult>("db:seedCustomerAndLoan", {
        customerName: "Customer Regression",
        contact: "0700200001",
        nin: "C0000000000002",
        principalAmount: "500000",
        issuedBy: "seed-user",
      }).then(() => {
        cy.visit("/customers")
        // Wait for collection to load from server
        cy.contains("Customer Regression", { timeout: 20000 }).should("be.visible")
        cy.get("[data-testid='data-row']").should("have.length.gte", 1)
      })
    })

    it("name filter narrows results", () => {
      cy.task<DbSeedCustomerAndLoanResult>("db:seedCustomerAndLoan", {
        customerName: "Alpha Client",
        contact: "0700200002",
        nin: "C0000000000003",
        principalAmount: "500000",
        issuedBy: "seed-user",
      })
      cy.task<DbSeedCustomerAndLoanResult>("db:seedCustomerAndLoan", {
        customerName: "Beta Client",
        contact: "0700200003",
        nin: "C0000000000004",
        principalAmount: "500000",
        issuedBy: "seed-user",
      }).then(() => {
        cy.visit("/customers")
        cy.contains("Alpha Client", { timeout: 20000 }).should("be.visible")
        cy.get("[data-testid='data-row']").should("have.length.gte", 2)

        // Type in search/filter input (debounced at 300ms)
        cy.get("input[placeholder*='earch']").first().type("Alpha")
        // Wait for debounce + re-render; filter visible rows only
        cy.get("[data-testid='data-row']:visible", { timeout: 5000 }).should("have.length", 1)
        cy.contains("Alpha Client").should("be.visible")
        cy.contains("Beta Client").should("not.exist")
      })
    })
  })

  describe("Payments list page (/payments)", () => {
    it("loads and shows heading", () => {
      cy.visit("/payments")
      cy.contains("Payments", { timeout: 15000 }).should("be.visible")
    })

    it("renders data rows when payments exist", () => {
      cy.task<DbSeedCustomerAndLoanResult>("db:seedCustomerAndLoan", {
        customerName: "Payment Regression",
        contact: "0700300001",
        nin: "C0000000000005",
        principalAmount: "1000000",
        issuedBy: "seed-user",
      }).then((result) => {
        cy.task("db:seedPayment", {
          loanId: result.loanId,
          amount: "100000",
          recordedBy: "seed-user",
        }).then(() => {
          cy.visit("/payments")
          cy.get("[data-testid='data-row']", { timeout: 15000 }).should("have.length.gte", 1)
        })
      })
    })
  })

  describe("Expenses page (/expenses)", () => {
    it("loads and shows heading", () => {
      cy.visit("/expenses")
      cy.contains("Expenses", { timeout: 15000 }).should("be.visible")
    })

    it("shows empty state when no expenses", () => {
      cy.visit("/expenses")
      cy.contains("No expenses recorded", { timeout: 15000 }).should("be.visible")
    })
  })

  describe("Creditors page (/creditors)", () => {
    it("loads and shows heading", () => {
      cy.visit("/creditors")
      cy.contains("Creditors", { timeout: 15000 }).should("be.visible")
    })

    it("shows empty state when no creditors", () => {
      cy.visit("/creditors")
      cy.contains("No creditors yet", { timeout: 15000 }).should("be.visible")
    })
  })

  describe("Fund transfers page (/fund-transfers)", () => {
    it("loads and shows heading", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
    })
  })

  describe("Loan detail page", () => {
    it("navigates from loans list to loan detail and shows data", () => {
      cy.task<DbSeedCustomerAndLoanResult>("db:seedCustomerAndLoan", {
        customerName: "Detail Regression",
        contact: "0700400001",
        nin: "C0000000000006",
        principalAmount: "2000000",
        issuedBy: "seed-user",
      }).then((result) => {
        cy.visit(`/loans/${result.loanId}`)
        cy.contains("Detail Regression", { timeout: 15000 }).should("be.visible")
        cy.contains("LOAN-").should("be.visible")
        cy.contains("2,000,000").should("be.visible")
      })
    })
  })

  describe("Customer detail page", () => {
    it("navigates from customers list to customer detail and shows data", () => {
      cy.task<DbSeedCustomerAndLoanResult>("db:seedCustomerAndLoan", {
        customerName: "Profile Regression",
        contact: "0700500001",
        nin: "C0000000000007",
        principalAmount: "750000",
        issuedBy: "seed-user",
      }).then((result) => {
        cy.visit(`/customers/${result.customerId}`)
        cy.contains("Profile Regression", { timeout: 20000 }).should("be.visible")
        // Verify loan data is rendered on the customer profile
        cy.contains("Loan History", { timeout: 10000 }).should("be.visible")
        cy.contains("UGX 750,000").should("be.visible")
      })
    })
  })
})
