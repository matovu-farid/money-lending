describe("Report Detail Pages", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Reports Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  describe("Balance Sheet (/reports/balance-sheet)", () => {
    it("renders the page with heading and formal header", () => {
      cy.visit("/reports/balance-sheet")
      cy.contains("Balance Sheet", { timeout: 15000 }).should("be.visible")
      cy.contains("Assets, liabilities, and equity").should("be.visible")
      cy.contains("Sovereign Ledger").should("be.visible")
    })

    it("shows Assets section with current and non-current assets", () => {
      cy.visit("/reports/balance-sheet")
      cy.contains("Assets", { timeout: 15000 }).should("be.visible")
      cy.contains("Current Assets").should("be.visible")
      cy.contains("Cash on Hand").should("be.visible")
      cy.contains("Bank").should("be.visible")
      cy.contains("Strong Room").should("be.visible")
      cy.contains("Total Current Assets").should("be.visible")
      cy.contains("Non-Current Assets").should("be.visible")
      cy.contains("Loans Outstanding").should("be.visible")
      cy.contains("Total Assets").should("be.visible")
    })

    it("shows Liabilities and Equity sections", () => {
      cy.visit("/reports/balance-sheet")
      cy.contains("Liabilities", { timeout: 15000 }).should("be.visible")
      cy.contains("Current Liabilities").should("be.visible")
      cy.contains("Creditor Balances").should("be.visible")
      cy.contains("Total Liabilities").should("be.visible")
      cy.contains("Owner's Equity").should("be.visible")
      cy.contains("Share Capital").should("be.visible")
      cy.contains("Retained Earnings").should("be.visible")
      cy.contains("Total Equity").should("be.visible")
      cy.contains("Total Liabilities & Equity").should("be.visible")
    })

    it("has a back link to reports hub", () => {
      cy.visit("/reports/balance-sheet")
      cy.contains("Reports", { timeout: 15000 })
        .closest("a")
        .should("have.attr", "href", "/reports")
    })

    it("has a period selector", () => {
      cy.visit("/reports/balance-sheet")
      // The period selector is a Select component with a trigger button
      cy.get("[data-slot=select-trigger]", { timeout: 15000 }).should("exist")
    })

    it("has export PDF and Excel buttons", () => {
      cy.visit("/reports/balance-sheet")
      cy.contains("Export PDF", { timeout: 15000 }).should("be.visible")
      cy.contains("Export Excel").should("be.visible")
    })
  })

  describe("Profit & Loss (/reports/pnl)", () => {
    it("renders the page with heading", () => {
      cy.visit("/reports/pnl")
      cy.contains("Profit & Loss", { timeout: 15000 }).should("be.visible")
      cy.contains("Revenue and expense summary").should("be.visible")
    })

    it("shows formal accounting header", () => {
      cy.visit("/reports/pnl")
      // Either shows the report card or the empty state
      cy.get("body", { timeout: 15000 }).then(($body) => {
        if ($body.text().includes("Sovereign Ledger")) {
          cy.contains("Sovereign Ledger").should("be.visible")
          cy.contains("Income Statement").should("be.visible")
        } else {
          cy.contains("No data available for the selected period").should("be.visible")
        }
      })
    })

    it("shows empty state when no data", () => {
      cy.visit("/reports/pnl")
      // With a fresh DB, there's no income/expense data
      cy.contains("No data available for the selected period", { timeout: 15000 }).should(
        "be.visible"
      )
    })

    it("has a back link to reports hub", () => {
      cy.visit("/reports/pnl")
      cy.contains("Reports", { timeout: 15000 })
        .closest("a")
        .should("have.attr", "href", "/reports")
    })

    it("has export buttons", () => {
      cy.visit("/reports/pnl")
      cy.contains("Export PDF", { timeout: 15000 }).should("be.visible")
      cy.contains("Export Excel").should("be.visible")
    })
  })

  describe("Retained Earnings (/reports/retained-earnings)", () => {
    it("renders the page with heading", () => {
      cy.visit("/reports/retained-earnings")
      cy.contains("Retained Earnings", { timeout: 15000 }).should("be.visible")
      cy.contains("Changes in retained earnings for the period").should("be.visible")
    })

    it("shows the statement of retained earnings", () => {
      cy.visit("/reports/retained-earnings")
      cy.contains("Sovereign Ledger", { timeout: 15000 }).should("be.visible")
      cy.contains("Statement of Retained Earnings").should("be.visible")
      cy.contains("Add: Net Income").should("be.visible")
    })

    it("has a back link to reports hub", () => {
      cy.visit("/reports/retained-earnings")
      cy.contains("Reports", { timeout: 15000 })
        .closest("a")
        .should("have.attr", "href", "/reports")
    })
  })

  describe("Portfolio Report (/reports/portfolio)", () => {
    it("renders the page with heading", () => {
      cy.visit("/reports/portfolio")
      cy.contains("Portfolio Report", { timeout: 15000 }).should("be.visible")
      cy.contains("Loan portfolio analysis").should("be.visible")
    })

    it("shows empty state when no active loans", () => {
      cy.visit("/reports/portfolio")
      cy.contains("No active loans to display", { timeout: 15000 }).should("be.visible")
    })

    it("has a back link to reports hub", () => {
      cy.visit("/reports/portfolio")
      cy.contains("Reports", { timeout: 15000 })
        .closest("a")
        .should("have.attr", "href", "/reports")
    })

    it("has export buttons", () => {
      cy.visit("/reports/portfolio")
      cy.contains("Export PDF", { timeout: 15000 }).should("be.visible")
      cy.contains("Export Excel").should("be.visible")
    })

    it("shows table with correct headers when loans exist", () => {
      // Create a customer
      cy.visit("/customers/new")
      cy.get("#fullName").type("Portfolio Test Customer")
      cy.get("#contact").type("0700000001")
      cy.get("#address").type("Kampala, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.url().then((url) => {
        const cid = url.split("/customers/")[1]
        // Create a loan via wizard
        cy.visit(`/loans/new?customerId=${cid}`)
        cy.get("#principalAmount").type("500000")
        cy.get("#issuanceFee").type("50000")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Phone")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.dismissReceiptModal()

        // Visit portfolio report
        cy.visit("/reports/portfolio")
        cy.get("th", { timeout: 15000 }).should("contain", "Customer")
        cy.get("th").should("contain", "Loan Amount")
        cy.get("th").should("contain", "Outstanding")
        cy.get("th").should("contain", "Status")
        cy.get("th").should("contain", "Risk")
        cy.get("[data-testid='data-row']").should("have.length.gte", 1)
      })
    })
  })

  describe("Active Loans Report (/reports/active-loans)", () => {
    it("renders the page with heading", () => {
      cy.visit("/reports/active-loans")
      cy.contains("Active Loans Report", { timeout: 15000 }).should("be.visible")
      cy.contains("Overview of all currently active loans").should("be.visible")
    })

    it("shows empty state when no active loans", () => {
      cy.visit("/reports/active-loans")
      cy.contains("No active loans to display", { timeout: 15000 }).should("be.visible")
    })

    it("has a back link to reports hub", () => {
      cy.visit("/reports/active-loans")
      cy.contains("Reports", { timeout: 15000 })
        .closest("a")
        .should("have.attr", "href", "/reports")
    })

    it("has a search filter", () => {
      cy.visit("/reports/active-loans")
      cy.get('input[placeholder*="Search by customer name"]', { timeout: 15000 }).should("exist")
    })

    it("shows loan count summary", () => {
      cy.visit("/reports/active-loans")
      cy.contains("Showing 0 of 0 active loans", { timeout: 15000 }).should("be.visible")
    })
  })
})
