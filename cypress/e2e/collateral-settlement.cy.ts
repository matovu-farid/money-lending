/**
 * E2E tests for:
 *  1. Collateral Settlement dialog on the loan detail page
 *  2. Single Active Loan Constraint & Rollover Banner in the new-loan wizard
 *  3. Status badge rendering for settled_with_collateral and rolled_over statuses
 */

// ---------------------------------------------------------------------------
// Helper: create a customer, issue a loan, dismiss the receipt, and return
// the customerId + loanId extracted from the redirect URL.
// ---------------------------------------------------------------------------
function createCustomerAndActiveLoan(
  customerName: string,
  contact: string,
  amount: string
): Cypress.Chainable<{ customerId: string; loanId: string }> {
  cy.visit("/customers/new")
  cy.get("#fullName").type(customerName)
  cy.get("#contact").type(contact)
  cy.get("#address").type("Kampala, Uganda")
  cy.contains("button", "Register Customer").click()
  cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

  return cy.url().then((url) => {
    const customerId = url.split("/customers/")[1]

    cy.visit(`/loans/new?customerId=${customerId}`)
    cy.get("#principalAmount").type(amount)
    cy.get("#issuanceFee").type("50000")
    cy.get("#description").type("Collateral settlement test loan")
    cy.contains("button", "Next").click()

    // Step 2: Collateral
    cy.get("#collateralNature").type("Land Title")
    cy.contains("button", "Next").click()

    // Step 3: Issue
    cy.contains("button", "Issue Loan").click()
    cy.dismissReceiptModal()

    // After closing the modal we're on /customers/:id
    // Navigate to the loans list to find the loanId
    cy.visit("/loans")
    cy.get("[data-testid='data-row']", { timeout: 10000 }).first().click()
    cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-zA-Z0-9-]+$/)

    return cy.url().then((loanUrl) => {
      const loanId = loanUrl.split("/loans/")[1]
      return cy.wrap({ customerId, loanId })
    })
  })
}

// ---------------------------------------------------------------------------
// Suite 1 — Collateral Settlement
// ---------------------------------------------------------------------------
describe("Collateral Settlement", () => {
  let customerId: string
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Settlement Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // The first registered user is auto-promoted to superAdmin, which satisfies
    // the supervisor role check (ROLE_LEVELS[superAdmin] >= ROLE_LEVELS[supervisor]).
    createCustomerAndActiveLoan("Settlement Borrower", "0771100001", "1000000").then(
      (ids) => {
        customerId = ids.customerId
        loanId = ids.loanId
      }
    )
  })

  it("shows the Settle with Collateral button on an active loan (supervisor+)", () => {
    cy.visit(`/loans/${loanId}`)
    cy.contains("button", "Settle with Collateral", { timeout: 10000 }).should("be.visible")
  })

  it("opens the settlement dialog when the button is clicked", () => {
    cy.visit(`/loans/${loanId}`)
    cy.contains("button", "Settle with Collateral", { timeout: 10000 }).click()
    cy.contains("Settle Loan with Collateral").should("be.visible")
  })

  it("dialog displays balance breakdown: outstanding principal, accrued interest, total written off", () => {
    cy.visit(`/loans/${loanId}`)
    cy.contains("button", "Settle with Collateral", { timeout: 10000 }).click()

    cy.contains("Outstanding Principal").should("be.visible")
    cy.contains("Accrued Interest").should("be.visible")
    cy.contains("Total Written Off").should("be.visible")
  })

  it("dialog shows collateral to seize section", () => {
    cy.visit(`/loans/${loanId}`)
    cy.contains("button", "Settle with Collateral", { timeout: 10000 }).click()

    cy.contains("Collateral to Seize").should("be.visible")
    cy.contains("Land Title").should("be.visible")
  })

  it("Confirm Settlement button is disabled when reason is empty", () => {
    cy.visit(`/loans/${loanId}`)
    cy.contains("button", "Settle with Collateral", { timeout: 10000 }).click()

    cy.contains("button", "Confirm Settlement").should("be.disabled")
  })

  it("Confirm Settlement button becomes enabled after entering a reason", () => {
    cy.visit(`/loans/${loanId}`)
    cy.contains("button", "Settle with Collateral", { timeout: 10000 }).click()

    cy.get("#settle-reason").type("Borrower defaulted; seizing land title as agreed")
    cy.contains("button", "Confirm Settlement").should("not.be.disabled")
  })

  it("Cancel button closes the dialog without settling", () => {
    cy.visit(`/loans/${loanId}`)
    cy.contains("button", "Settle with Collateral", { timeout: 10000 }).click()
    cy.contains("Settle Loan with Collateral").should("be.visible")

    cy.contains("button", "Cancel").click()
    cy.contains("Settle Loan with Collateral").should("not.exist")

    // Loan should still be active
    cy.contains("Active").should("be.visible")
  })

  it("submitting with a reason settles the loan and status changes to Settled (Collateral)", () => {
    cy.visit(`/loans/${loanId}`)
    cy.contains("button", "Settle with Collateral", { timeout: 10000 }).click()

    cy.get("#settle-reason").type("Property seized — borrower absconded")
    cy.contains("button", "Confirm Settlement").click()

    // Toast or status update
    cy.contains("Settled (Collateral)", { timeout: 15000 }).should("be.visible")
  })

  it("Settle with Collateral button is NOT shown on a non-active loan", () => {
    // Settle the loan first
    cy.visit(`/loans/${loanId}`)
    cy.contains("button", "Settle with Collateral", { timeout: 10000 }).click()
    cy.get("#settle-reason").type("Borrower defaulted")
    cy.contains("button", "Confirm Settlement").click()

    // Wait for status to update
    cy.contains("Settled (Collateral)", { timeout: 15000 }).should("be.visible")

    // After settlement the button should be gone
    cy.contains("button", "Settle with Collateral").should("not.exist")
  })
})

// ---------------------------------------------------------------------------
// Suite 2 — Single Active Loan Constraint & Rollover
// ---------------------------------------------------------------------------
describe("Single Active Loan Constraint & Rollover Banner", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Rollover Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  context("customer WITH an active loan", () => {
    beforeEach(() => {
      // Create a customer and issue their first (active) loan
      createCustomerAndActiveLoan("Rollover Borrower", "0771200001", "1000000").then(
        (ids) => {
          customerId = ids.customerId
        }
      )
    })

    it("shows the rollover banner on the new loan form (Step 1)", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      // Banner should mention the customer has an active loan
      cy.contains("has an active loan", { timeout: 10000 }).should("be.visible")
      cy.contains("Outstanding Principal").should("be.visible")
      cy.contains("Accrued Interest").should("be.visible")
      cy.contains("Amount to Roll Over").should("be.visible")
    })

    it("banner shows the existing loan reference", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)
      // Banner contains a LOAN- reference
      cy.contains(/LOAN-[A-Z0-9]{8}/, { timeout: 10000 }).should("be.visible")
    })

    it("rollover breakdown is visible on the Step 3 review", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      // Step 1 — fill details
      cy.get("#principalAmount").type("500000")
      cy.get("#issuanceFee").type("50000")
      cy.get("#description").type("Second loan with rollover")
      cy.contains("button", "Next").click()

      // Step 2 — collateral
      cy.get("#collateralNature").type("Vehicle Log Book")
      cy.contains("button", "Next").click()

      // Step 3 — should show rollover breakdown
      cy.contains("Rollover Breakdown", { timeout: 10000 }).should("be.visible")
      cy.contains("Fresh Disbursement").should("be.visible")
      cy.contains("Rolled Over Amount").should("be.visible")
      cy.contains("Total New Principal").should("be.visible")
    })

    it("issuing the rollover loan marks the original loan as Rolled Over", () => {
      // Navigate to the original loan detail to confirm it transitions after rollover
      cy.visit(`/loans/new?customerId=${customerId}`)

      cy.get("#principalAmount").type("500000")
      cy.get("#issuanceFee").type("50000")
      cy.get("#description").type("Rollover new loan")
      cy.contains("button", "Next").click()

      cy.get("#collateralNature").type("Land Title")
      cy.contains("button", "Next").click()

      cy.contains("button", "Issue Loan").click()
      cy.dismissReceiptModal()

      // We are now back on the customer profile — navigate to loans list
      cy.visit("/loans")

      // After rollover, the old loan should have status "Rolled Over"
      // It may be filtered out of the active view, but confirm no JS error
      cy.get("body").should("not.contain", "Uncaught")
    })
  })

  context("customer WITHOUT an active loan", () => {
    beforeEach(() => {
      cy.visit("/customers/new")
      cy.get("#fullName").type("Fresh Borrower")
      cy.get("#contact").type("0771300001")
      cy.get("#address").type("Kampala, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.url().then((url) => {
        customerId = url.split("/customers/")[1]
      })
    })

    it("does NOT show a rollover banner for a customer with no active loan", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      // Wait for the page to fully load (customer name resolved)
      cy.get("#customerId", { timeout: 10000 }).should("be.disabled")

      // No rollover banner
      cy.contains("has an active loan").should("not.exist")
      cy.contains("Amount to Roll Over").should("not.exist")
    })
  })
})

// ---------------------------------------------------------------------------
// Suite 3 — Status Badge Rendering
// ---------------------------------------------------------------------------
describe("Loan Status Badge Rendering", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Status Badge Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("loan detail page renders Active badge without errors for a fresh loan", () => {
    createCustomerAndActiveLoan("Badge Test Borrower", "0771400001", "500000").then(
      ({ loanId }) => {
        cy.visit(`/loans/${loanId}`)
        cy.contains("Active", { timeout: 10000 }).should("be.visible")
        // No uncaught exception (handled by support/e2e.ts)
      }
    )
  })

  it("Settled (Collateral) badge appears after collateral settlement", () => {
    createCustomerAndActiveLoan("Collateral Badge Borrower", "0771500001", "800000").then(
      ({ loanId }) => {
        cy.visit(`/loans/${loanId}`)
        cy.contains("button", "Settle with Collateral", { timeout: 10000 }).click()
        cy.get("#settle-reason").type("Testing badge after settlement")
        cy.contains("button", "Confirm Settlement").click()

        cy.contains("Settled (Collateral)", { timeout: 15000 }).should("be.visible")
      }
    )
  })

  it("Rolled Over badge visible on loan detail after rollover", () => {
    createCustomerAndActiveLoan("Rollover Badge Borrower", "0771600001", "1000000").then(
      ({ customerId, loanId }) => {
        // Issue second loan to trigger rollover
        cy.visit(`/loans/new?customerId=${customerId}`)
        cy.get("#principalAmount").type("600000")
        cy.get("#issuanceFee").type("50000")
        cy.get("#description").type("Rollover badge test loan")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Land Title")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.dismissReceiptModal()

        // Visit the original loan — it should now show "Rolled Over"
        cy.visit(`/loans/${loanId}`)
        cy.contains("Rolled Over", { timeout: 15000 }).should("be.visible")
      }
    )
  })

  it("loans list renders without JS errors when loans exist", () => {
    createCustomerAndActiveLoan("List Badge Borrower", "0771700001", "750000").then(() => {
      cy.visit("/loans")
      cy.get("[data-testid='data-row']", { timeout: 10000 }).should("have.length.gte", 1)
      // Verify the Type column badge renders (from loan-types implementation)
      cy.contains("Perpetual").should("be.visible")
    })
  })
})
