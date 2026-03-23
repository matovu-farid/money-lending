/**
 * E2E tests for the /payments global payments list page (Phase 06).
 * Covers: page rendering, table columns, filters, clear filters,
 * admin edit/delete actions, CSV export, sidebar link, and empty states.
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

  describe("Page rendering", () => {
    it("shows payments page with heading and table", () => {
      cy.visit("/payments")
      cy.contains("h1", "Payments", { timeout: 15000 }).should("be.visible")
      // Table headers
      cy.contains("th", "Date").should("exist")
      cy.contains("th", "Customer").should("exist")
      cy.contains("th", "Loan Ref").should("exist")
      cy.contains("th", "Amount").should("exist")
      cy.contains("th", "Interest").should("exist")
      cy.contains("th", "Principal").should("exist")
      cy.contains("th", "Balance After").should("exist")
    })

    it("shows payment row with correct data", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")
      cy.contains("300,000").should("be.visible")
      cy.contains("LOAN-").should("be.visible")
    })

    it("shows Export CSV button", () => {
      cy.visit("/payments")
      cy.contains("button", "Export CSV", { timeout: 15000 }).should("be.visible")
    })
  })

  describe("Sidebar link", () => {
    it("sidebar Payments link navigates to /payments", () => {
      cy.visit("/dashboard")
      // Wait for sidebar to render
      cy.contains("Payments", { timeout: 15000 }).should("be.visible")
      // Find the payments link in the sidebar nav
      cy.get("nav").contains("a", "Payments").click()
      cy.url({ timeout: 10000 }).should("include", "/payments")
      cy.contains("h1", "Payments").should("be.visible")
    })
  })

  describe("Empty states", () => {
    it("shows empty state when no payments exist", () => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Empty Admin" })
      cy.visit("/payments")
      cy.contains("No payments recorded", { timeout: 15000 }).should("be.visible")
      cy.contains("Payments appear here once loans are active").should("be.visible")
    })
  })

  describe("Filter bar", () => {
    it("shows filter inputs", () => {
      cy.visit("/payments")
      cy.get("input[placeholder='Search by customer name...']", { timeout: 15000 }).should("be.visible")
      cy.contains("label", "From").should("be.visible")
      cy.contains("label", "To").should("be.visible")
      cy.contains("label", "Min amount").should("be.visible")
      cy.contains("label", "Max amount").should("be.visible")
    })

    it("filters by customer name", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      // Search for a non-matching name
      cy.get("input[placeholder='Search by customer name...']").type("zzzzzzz")
      // Wait for debounce + URL update
      cy.url({ timeout: 5000 }).should("include", "customerName=zzzzzzz")
      cy.contains("No payments match your filters", { timeout: 10000 }).should("be.visible")
    })

    it("shows Clear filters button when filters are active", () => {
      cy.visit("/payments")
      // No clear button initially
      cy.contains("button", "Clear filters").should("not.exist")

      // Type in customer search
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

    it("filters by amount range", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      // Set min amount higher than recorded payment
      cy.get("input[placeholder='0']").type("500000")
      cy.url({ timeout: 5000 }).should("include", "amountMin=500000")
      cy.contains("No payments match your filters", { timeout: 10000 }).should("be.visible")
    })
  })

  describe("Admin actions", () => {
    it("shows actions dropdown with Edit and Delete for admin", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      // Click the actions button on the row
      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Edit").should("be.visible")
      cy.contains("Delete").should("be.visible")
    })

    it("opens Edit Payment sheet with form fields", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Edit").click()

      // Sheet should open with form fields
      cy.contains("Edit Payment", { timeout: 5000 }).should("be.visible")
      cy.get("#edit-payment-date").should("be.visible")
      cy.get("#edit-payment-amount").should("be.visible")
      cy.get("#edit-payment-reason").should("be.visible")
      cy.contains("button", "Save changes").should("be.visible")
    })

    it("edits a payment successfully", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Edit").click()

      cy.get("#edit-payment-amount").clear().type("350000")
      cy.get("#edit-payment-reason").type("Correction: amount was wrong")
      cy.contains("button", "Save changes").click()

      // Should show success toast
      cy.contains("Payment updated", { timeout: 10000 }).should("be.visible")
    })

    it("opens Delete payment dialog with reason field", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Delete").click()

      cy.contains("Delete payment?", { timeout: 5000 }).should("be.visible")
      cy.contains("This payment and its cascade recalculations will be reversed").should("be.visible")
      cy.get("#delete-payment-reason").should("be.visible")
      cy.contains("button", "Keep payment").should("be.visible")
      cy.contains("button", "Delete payment").should("be.visible")
    })

    it("delete button is disabled until reason is provided", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Delete").click()

      // Delete button should be disabled without reason
      cy.contains("button", "Delete payment").should("be.disabled")

      // Type a reason
      cy.get("#delete-payment-reason").type("Duplicate entry")
      cy.contains("button", "Delete payment").should("not.be.disabled")
    })

    it("deletes a payment successfully", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Delete").click()

      cy.get("#delete-payment-reason").type("Was recorded in error")
      cy.contains("button", "Delete payment").click()

      // Should show success toast
      cy.contains("Payment deleted", { timeout: 10000 }).should("be.visible")
      // Payment should be gone from the list
      cy.contains("No payments recorded", { timeout: 10000 }).should("be.visible")
    })

    it("Keep payment button closes the dialog without deleting", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")

      cy.get("button[aria-label='Payment actions']").first().click()
      cy.contains("Delete").click()
      cy.contains("Delete payment?").should("be.visible")

      cy.contains("button", "Keep payment").click()

      // Dialog should close and payment should still be visible
      cy.contains("Delete payment?").should("not.exist")
      cy.contains("Grace Namubiru").should("be.visible")
    })
  })

  describe("CSV export", () => {
    it("Export CSV button is enabled when rows exist", () => {
      cy.visit("/payments")
      cy.contains("Grace Namubiru", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Export CSV").should("not.be.disabled")
    })

    it("Export CSV button is disabled when no rows", () => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "CSV Admin" })
      cy.visit("/payments")
      cy.contains("No payments recorded", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Export CSV").should("be.disabled")
    })
  })
})
