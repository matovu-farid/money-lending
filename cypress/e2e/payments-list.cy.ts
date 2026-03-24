/**
 * E2E tests for the /payments global payments list page (Phase 06).
 * Covers PAY-01 through PAY-08: page rendering, table columns, filters
 * (date range, amount range, customer name), admin edit/delete actions,
 * CSV export, pagination, empty states, and sidebar navigation.
 */
describe("Global Payments List (/payments)", () => {
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Payments Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create customer + loan + record a payment so the page has data
    cy.visit("/customers/new")
    cy.get("#fullName").type("Grace Namubiru")
    cy.get("#contact").type("0771000050")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

    cy.url().then((url) => {
      const customerId = url.split("/customers/")[1]

      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.get("#principalAmount").type("2000000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").type("Land Title")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

      cy.task("db:getLoans").then((loans: any) => {
        loanId = loans[0].id

        // Record a payment
        cy.visit(`/loans/${loanId}/payments/new`)
        cy.get("#amount", { timeout: 10000 }).type("300000")
        cy.contains("button", "Record Payment").click()
        cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}`)
        cy.contains("300,000", { timeout: 10000 }).should("exist")
      })
    })
  })

  describe("PAY-01: Page loads with paginated table", () => {
    it("renders the payments page with heading and All Payments / Daily tabs", () => {
      cy.visit("/payments")
      cy.contains("h1", "Payments", { timeout: 15000 }).should("be.visible")
      cy.contains("All Payments", { timeout: 10000 }).should("be.visible")
      cy.contains("Daily", { timeout: 10000 }).should("be.visible")
    })

    it("shows payment rows in a table", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")
      // Table element should exist with at least one row
      cy.get("table", { timeout: 10000 }).should("exist")
      cy.get("[data-testid='data-row']").should("have.length.at.least", 1)
    })
  })

  describe("PAY-02: Table shows correct columns", () => {
    it("shows all required table headers", () => {
      cy.visit("/payments")
      cy.contains("th", "Date", { timeout: 15000 }).should("exist")
      cy.contains("th", "Customer").should("exist")
      cy.contains("th", "Loan Ref").should("exist")
      cy.contains("th", "Amount").should("exist")
      cy.contains("th", "Interest").should("exist")
      cy.contains("th", "Principal").should("exist")
      cy.contains("th", "Balance After").should("exist")
    })

    it("shows payment row with customer name, loan ref, and formatted amount", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")
      cy.contains("300,000").should("be.visible")
      cy.contains("LOAN-").should("be.visible")
      cy.contains("UGX").should("be.visible")
    })
  })

  describe("PAY-03: Date range filter", () => {
    it("shows From and To date inputs in filter bar", () => {
      cy.visit("/payments")
      cy.contains("label", "From", { timeout: 15000 }).should("be.visible")
      cy.contains("label", "To").should("be.visible")
      cy.get('input[type="date"]', { timeout: 10000 }).should("have.length.at.least", 2)
    })

    it("filters out payments when date range excludes them", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      // Set date range far in the past — payment was just recorded today
      cy.get('input[type="date"]').first().type("2020-01-01")
      cy.get('input[type="date"]').eq(1).type("2020-01-31")
      cy.url({ timeout: 5000 }).should("include", "dateFrom=2020-01-01")
      cy.contains("No payments match your filters", { timeout: 15000 }).should("be.visible")
    })

    it("shows payments when date range includes today", () => {
      const today = new Date().toISOString().slice(0, 10)
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      // Set From to today — payment should still be visible
      cy.get('input[type="date"]').first().type(today)
      cy.url({ timeout: 5000 }).should("include", `dateFrom=${today}`)
      cy.contains("Grace Namubiru", { timeout: 10000 }).should("be.visible")
    })
  })

  describe("PAY-04: Amount range filter", () => {
    it("shows Min amount and Max amount filter inputs", () => {
      cy.visit("/payments")
      cy.contains("label", "Min amount", { timeout: 15000 }).should("be.visible")
      cy.contains("label", "Max amount").should("be.visible")
    })

    it("filters by min amount (excludes when too high)", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      // Set min amount higher than the 300,000 payment
      cy.get("input[placeholder='0']").type("500000")
      cy.url({ timeout: 5000 }).should("include", "amountMin=500000")
      cy.contains("No payments match your filters", { timeout: 10000 }).should("be.visible")
    })

    it("filters by max amount (excludes when too low)", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      // Set max amount lower than the 300,000 payment
      cy.get("input[placeholder='Any']").type("100000")
      cy.url({ timeout: 5000 }).should("include", "amountMax=100000")
      cy.contains("No payments match your filters", { timeout: 10000 }).should("be.visible")
    })

    it("shows payment when amount is within range", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      // Set range that includes the 300,000 payment
      cy.get("input[placeholder='0']").type("200000")
      cy.get("input[placeholder='Any']").type("400000")
      cy.url({ timeout: 5000 }).should("include", "amountMin=200000")
      cy.contains("Grace Namubiru", { timeout: 10000 }).should("be.visible")
    })
  })

  describe("PAY-05: Customer name search", () => {
    it("shows customer name search input", () => {
      cy.visit("/payments")
      cy.get("input[placeholder='Search by customer name...']", { timeout: 15000 }).should(
        "be.visible"
      )
    })

    it("filters by matching customer name", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("input[placeholder='Search by customer name...']").type("Grace")
      cy.url({ timeout: 5000 }).should("include", "customerName=Grace")
      cy.contains("Grace Namubiru", { timeout: 10000 }).should("be.visible")
    })

    it("shows no results for non-matching customer name", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("input[placeholder='Search by customer name...']").type("zzzzzzz")
      cy.url({ timeout: 5000 }).should("include", "customerName=zzzzzzz")
      cy.contains("No payments match your filters", { timeout: 10000 }).should("be.visible")
    })

    it("shows Clear filters button when filter is active", () => {
      cy.visit("/payments")
      // No clear button initially
      cy.contains("button", "Clear filters").should("not.exist")

      cy.get("input[placeholder='Search by customer name...']", { timeout: 15000 }).type("test")
      cy.url({ timeout: 5000 }).should("include", "customerName=test")
      cy.contains("button", "Clear filters", { timeout: 5000 }).should("be.visible")
    })

    it("Clear filters resets all filters and URL", () => {
      cy.visit("/payments?customerName=test&amountMin=1000")
      cy.contains("button", "Clear filters", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Clear filters").click()
      cy.url({ timeout: 5000 }).should("eq", Cypress.config().baseUrl + "/payments")
    })
  })

  describe("PAY-06: Admin edit payment", () => {
    it("shows actions dropdown with Edit and Delete for admin", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Edit").should("be.visible")
      cy.contains("Delete").should("be.visible")
    })

    it("opens Edit Payment sheet with form fields", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Edit").click()

      cy.contains("Edit Payment", { timeout: 5000 }).should("be.visible")
      cy.get("#edit-payment-date").should("be.visible")
      cy.get("#edit-payment-amount").should("be.visible")
      cy.get("#edit-payment-reason").should("be.visible")
      cy.contains("button", "Save changes").should("be.visible")
    })

    it("Save changes button is disabled until reason is provided", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Edit").click()

      // Save button should be disabled without a reason
      cy.contains("button", "Save changes", { timeout: 5000 }).should("be.disabled")

      // Type a reason — Save button should become enabled
      cy.get("#edit-payment-reason").type("Correcting amount error")
      cy.contains("button", "Save changes").should("not.be.disabled")
    })

    it("edits a payment successfully and shows success toast", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Edit").click()

      cy.get("#edit-payment-amount").clear().type("350000")
      cy.get("#edit-payment-reason").type("Correction: amount was wrong")
      cy.contains("button", "Save changes").click()

      cy.contains("Payment updated", { timeout: 10000 }).should("be.visible")
    })
  })

  describe("PAY-07: Admin delete payment", () => {
    it("opens Delete payment dialog with title, description, and reason field", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Delete").click()

      cy.contains("Delete payment?", { timeout: 5000 }).should("be.visible")
      cy.contains("This payment and its cascade recalculations will be reversed").should(
        "be.visible"
      )
      cy.get("#delete-payment-reason").should("be.visible")
      cy.contains("button", "Keep payment").should("be.visible")
      cy.contains("button", "Delete payment").should("be.visible")
    })

    it("Delete button is disabled until reason is provided", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Delete").click()

      cy.contains("button", "Delete payment").should("be.disabled")

      cy.get("#delete-payment-reason").type("Duplicate entry")
      cy.contains("button", "Delete payment").should("not.be.disabled")
    })

    it("Keep payment button closes the dialog without deleting", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Delete").click()
      cy.contains("Delete payment?").should("be.visible")

      cy.contains("button", "Keep payment").click()

      cy.contains("Delete payment?").should("not.exist")
      cy.contains("Grace Namubiru").should("be.visible")
    })

    it("deletes a payment successfully and shows success toast", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Delete").click()

      cy.get("#delete-payment-reason").type("Was recorded in error")
      cy.contains("button", "Delete payment").click()

      cy.contains("Payment deleted", { timeout: 10000 }).should("be.visible")
      // Payment should be gone — empty state should appear
      cy.contains("No payments recorded", { timeout: 10000 }).should("be.visible")
    })
  })

  describe("PAY-08: CSV export", () => {
    it("Export CSV button is enabled when rows exist", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Export CSV").should("not.be.disabled")
    })

    it("Export CSV button is disabled when no rows exist", () => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "CSV Admin" })
      cy.visit("/payments")
      cy.contains("No payments recorded", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Export CSV").should("be.disabled")
    })

    it("clicking Export CSV does not crash the page", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Export CSV").click()
      // Page should still be intact after clicking export
      cy.contains("h1", "Payments").should("be.visible")
      cy.contains("Grace Namubiru").should("be.visible")
    })
  })

  describe("Empty states", () => {
    it("shows 'No payments recorded' with helper text when database has no payments", () => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Empty Admin" })
      cy.visit("/payments")
      cy.contains("No payments recorded", { timeout: 15000 }).should("be.visible")
      cy.contains("Payments appear here once loans are active and payments are collected").should(
        "be.visible"
      )
    })

    it("shows 'No payments match your filters' with suggestion text when filters exclude all", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("input[placeholder='Search by customer name...']").type("ZZZZZZZZZ")
      cy.contains("No payments match your filters", { timeout: 15000 }).should("be.visible")
      cy.contains("Try adjusting the date range, amount range, or customer name search").should(
        "be.visible"
      )
      // Clear filters button inside the empty state
      cy.contains("button", "Clear filters").should("be.visible")
    })
  })

  describe("Pagination", () => {
    it("does not show pagination controls when total is 25 or fewer", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      // With only 1 payment, pagination should not appear
      cy.contains("button", "Previous").should("not.exist")
      cy.contains("button", "Next").should("not.exist")
      cy.contains("Showing").should("not.exist")
    })
  })

  describe("Sidebar navigation", () => {
    it("sidebar Payments link navigates to /payments", () => {
      cy.visit("/dashboard")
      cy.contains("Payments", { timeout: 15000 }).should("be.visible")
      cy.get("[data-testid='sidebar-nav']").contains("a", "Payments").click()
      cy.url({ timeout: 10000 }).should("include", "/payments")
      cy.contains("h1", "Payments").should("be.visible")
    })
  })
})
