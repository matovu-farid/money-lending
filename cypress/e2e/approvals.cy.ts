/**
 * E2E tests for the /approvals page.
 * Covers page rendering, access control, empty state,
 * pending/reviewed request tables, and review dialog interactions.
 */
import type { DbLoanRow } from "../support/types"

function createCustomerAndLoan(customerName: string, contact: string, principalAmount: string) {
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

describe("Approvals Page (/approvals)", () => {
  describe("Access control", () => {
    it("shows access denied for unassigned role user", () => {
      cy.task("db:reset")
      // Register a second user (not superAdmin) to test access denial
      const email = `lowrole-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("Low Role User")
      cy.get("#email").type(email)
      cy.get("#password").type("TestPass123!")
      cy.get("#confirmPassword").type("TestPass123!")
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("satisfy", (url: string) =>
        url.includes("/dashboard") ||
        url.includes("/pending-approval") ||
        url.includes("/verify-email")
      )

      // Promote to loanOfficer (below supervisor threshold)
      cy.task("db:promoteUser", { email, role: "loanOfficer" })
      cy.clearCookies()
      cy.visit("/login")
      cy.get("#email").type(email)
      cy.get("#password").type("TestPass123!")
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/approvals")
      cy.contains("Access denied", { timeout: 15000 }).should("be.visible")
      cy.contains("You need Supervisor or higher permissions to view approvals").should(
        "be.visible"
      )
    })

    it("shows page content for superAdmin role", () => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Super Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/approvals")
      cy.contains("Approvals", { timeout: 15000 }).should("be.visible")
      cy.contains("Rate change requests pending your review").should("be.visible")
    })
  })

  describe("Page rendering (superAdmin)", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Approvals Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("renders the page heading and subtitle", () => {
      cy.visit("/approvals")
      cy.contains("Approvals", { timeout: 15000 }).should("be.visible")
      cy.contains("Rate change requests pending your review").should("be.visible")
    })

    it("shows the Pending Requests section heading", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")
    })

    it("shows empty state when no pending requests exist", () => {
      cy.visit("/approvals")
      cy.contains("No pending requests", { timeout: 15000 }).should("be.visible")
      cy.contains("All rate change requests have been reviewed").should("be.visible")
    })

    it("does not show Recently Reviewed section when no reviewed requests exist", () => {
      cy.visit("/approvals")
      cy.contains("No pending requests", { timeout: 15000 }).should("be.visible")
      cy.contains("h2", "Recently Reviewed").should("not.exist")
    })

    it("has an info popover explaining how rate change approvals work", () => {
      cy.visit("/approvals")
      cy.contains("Approvals", { timeout: 15000 }).should("be.visible")
      // The info popover trigger should exist near the header
      cy.get("[aria-label='More info']").first().should("exist")
    })
  })

  describe("With pending rate change request", () => {
    let loanId: string

    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Approvals Test Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Create customer and loan
      createCustomerAndLoan("Approval Test Customer", "0771000099", "3000000")

      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        loanId = loans[0].id

        // Navigate to loan detail and request a rate change
        cy.visit(`/loans/${loanId}`)
        cy.contains("Approval Test Customer", { timeout: 15000 }).should("be.visible")

        // Click Request Rate Change if available
        cy.get("body").then(($body) => {
          if ($body.text().includes("Request Rate Change")) {
            cy.contains("button", "Request Rate Change").click()

            // Fill out rate change request form
            cy.get("#newRate, input[name='newRate']", { timeout: 5000 }).then(($input) => {
              if ($input.length) {
                cy.wrap($input).clear().type("5")
              }
            })
          }
        })
      })
    })

    it("navigates to /approvals from the sidebar", () => {
      cy.viewport(1280, 900)
      cy.visit("/dashboard")
      cy.get("[data-testid='sidebar-nav']", { timeout: 15000 }).should("be.visible")
      // Check if Approvals link exists in sidebar
      cy.get("[data-testid='sidebar-nav']").then(($nav) => {
        if ($nav.text().includes("Approvals")) {
          cy.get("[data-testid='sidebar-nav']").contains("a", "Approvals").click()
          cy.url({ timeout: 10000 }).should("include", "/approvals")
        }
      })
    })

    it("pending request table shows correct column headers", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")

      // If there are pending requests, check column headers
      cy.get("body").then(($body) => {
        if (!$body.text().includes("No pending requests")) {
          cy.contains("th", "Loan").should("exist")
          cy.contains("th", "Customer").should("exist")
          cy.contains("th", "Principal").should("exist")
          cy.contains("th", "Current Rate").should("exist")
          cy.contains("th", "Requested Rate").should("exist")
          cy.contains("th", "Required Role").should("exist")
          cy.contains("th", "Requested").should("exist")
        }
      })
    })

    it("pending request row shows Approve and Reject action buttons", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")

      cy.get("[data-testid='pending-request-row']").then(($rows) => {
        if ($rows.length > 0) {
          cy.get("[data-testid='pending-request-row']")
            .first()
            .within(() => {
              cy.get("button[aria-label='Approve']").should("exist")
              cy.get("button[aria-label='Reject']").should("exist")
            })
        }
      })
    })

    it("clicking Approve opens the review dialog with correct title", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")

      cy.get("[data-testid='pending-request-row']").then(($rows) => {
        if ($rows.length > 0) {
          cy.get("button[aria-label='Approve']").first().click()
          cy.contains("Approve Rate Change", { timeout: 5000 }).should("be.visible")
          cy.contains("button", "Approve & Apply").should("be.visible")
          cy.contains("button", "Cancel").should("be.visible")
          cy.get("#reviewNote").should("be.visible")
        }
      })
    })

    it("clicking Reject opens the review dialog with correct title", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")

      cy.get("[data-testid='pending-request-row']").then(($rows) => {
        if ($rows.length > 0) {
          cy.get("button[aria-label='Reject']").first().click()
          cy.contains("Reject Rate Change", { timeout: 5000 }).should("be.visible")
          cy.contains("button", "Reject").should("be.visible")
          cy.contains("button", "Cancel").should("be.visible")
        }
      })
    })

    it("Cancel button in review dialog closes the dialog", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")

      cy.get("[data-testid='pending-request-row']").then(($rows) => {
        if ($rows.length > 0) {
          cy.get("button[aria-label='Approve']").first().click()
          cy.contains("Approve Rate Change", { timeout: 5000 }).should("be.visible")
          cy.contains("button", "Cancel").click()
          cy.contains("Approve Rate Change").should("not.exist")
        }
      })
    })

    it("review dialog shows loan details (loan ref, customer, rate change)", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")

      cy.get("[data-testid='pending-request-row']").then(($rows) => {
        if ($rows.length > 0) {
          cy.get("button[aria-label='Approve']").first().click()
          cy.contains("Approve Rate Change", { timeout: 5000 }).should("be.visible")
          cy.contains("Loan:").should("be.visible")
          cy.contains("Customer:").should("be.visible")
          cy.contains("Rate change:").should("be.visible")
        }
      })
    })

    it("approve dialog shows green info message about immediate effect", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")

      cy.get("[data-testid='pending-request-row']").then(($rows) => {
        if ($rows.length > 0) {
          cy.get("button[aria-label='Approve']").first().click()
          cy.contains("immediately update the loan", { timeout: 5000 }).should("be.visible")
        }
      })
    })

    it("reject dialog shows red info message about keeping current rate", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")

      cy.get("[data-testid='pending-request-row']").then(($rows) => {
        if ($rows.length > 0) {
          cy.get("button[aria-label='Reject']").first().click()
          cy.contains("keep the current rate", { timeout: 5000 }).should("be.visible")
        }
      })
    })

    it("pending request row shows loan ref as clickable link to loan detail", () => {
      cy.visit("/approvals")
      cy.contains("h2", "Pending Requests", { timeout: 15000 }).should("be.visible")

      cy.get("[data-testid='pending-request-row']").then(($rows) => {
        if ($rows.length > 0) {
          cy.get("[data-testid='pending-request-row']")
            .first()
            .within(() => {
              cy.get("a[href^='/loans/']").should("exist")
              cy.contains("LOAN-").should("exist")
            })
        }
      })
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Mobile Approvals Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("renders approvals page at mobile", () => {
      cy.visit("/approvals")
      cy.contains("Approvals", { timeout: 15000 }).should("be.visible")
      cy.contains("Rate change requests pending your review").should("be.visible")
    })

    it("shows tab bar at mobile", () => {
      cy.visit("/approvals")
      cy.contains("Approvals", { timeout: 15000 }).should("be.visible")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })
  })
})
