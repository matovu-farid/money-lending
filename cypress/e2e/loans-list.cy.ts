function seedCustomerAndLoan(customerName: string, contact: string, amount: string) {
  return cy.get<string>("@testUserId").then((issuedBy) =>
    cy
      .task("db:seedCustomerAndLoan", {
        customerName,
        contact,
        nin: `CF${contact.slice(-10)}RL`,
        principalAmount: amount,
        issuedBy,
      })
      .then(({ customerId }) => cy.wrap(customerId))
  )
}

describe("Loans List (Unified)", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    const email = `loans-list-${Date.now()}@fidexa.org`
    cy.createTestUser({ name: "Loan Officer", email, role: "loanOfficer" }).then((user) => {
      cy.wrap(user.userId).as("testUserId")
      cy.visit("/dashboard")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })
  })

  context("empty state", () => {
    it("shows empty state when no loans exist", () => {
      cy.visit("/loans")
      cy.contains("h2", "No loans yet.", { timeout: 10000 }).should("be.visible")
      cy.contains("Issue your first loan by selecting a customer.").should("be.visible")
      cy.contains("button", "Issue Loan").should("be.visible")
    })
  })

  context("with loan data", () => {
    beforeEach(() => {
      seedCustomerAndLoan("Test Borrower", "0700000001", "1000000")
    })

    it("shows page heading and subtitle", () => {
      cy.visit("/loans")
      cy.get("h1", { timeout: 10000 }).contains("Loans").should("be.visible")
      cy.contains("All loans sorted by risk level").should("be.visible")
      cy.contains("Last calculated:").should("be.visible")
    })

    it("displays stat cards with correct labels", () => {
      cy.visit("/loans")
      cy.contains("Critical (30+ days)", { timeout: 10000 }).should("be.visible")
      cy.contains("At Risk (25-29 days)").should("be.visible")
      cy.contains("Early (0-24 days)").should("be.visible")
      cy.contains("All Loans").should("be.visible")
    })

    it("displays filter tabs with counts", () => {
      cy.visit("/loans")
      cy.contains("button", "All Loans", { timeout: 10000 }).should("be.visible")
      cy.contains("button", "Critical (30+ days)").should("be.visible")
      cy.contains("button", "At Risk (25-29 days)").should("be.visible")
      cy.contains("button", "Early (0-24 days)").should("be.visible")
    })

    it("clicking stat card activates matching filter", () => {
      cy.visit("/loans")
      cy.contains("Critical (30+ days)", { timeout: 10000 }).closest("button").click()
      // Stat card should have ring-2 class when active
      cy.contains("Critical (30+ days)").closest("button").should("have.class", "ring-2")
      // Filter tab for Critical should be active (default variant = solid background)
      cy.contains("button", /^Critical \(30\+\)/).should("not.have.attr", "data-state", "inactive")
    })

    it("Issue Loan button navigates to /loans/new", () => {
      cy.visit("/loans")
      cy.contains("button", "Issue Loan", { timeout: 10000 }).first().click()
      cy.url().should("include", "/loans/new")
    })

    it("filters loans by matching customer name", () => {
      cy.visit("/loans")
      cy.contains("Test Borrower", { timeout: 10000 }).should("be.visible")

      cy.get("input[placeholder='Search by customer name...']").type("Test")

      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
      cy.get("[data-testid='data-row']").filter(":visible").first().should("contain", "Test Borrower")
    })

    it("Print button exists", () => {
      cy.visit("/loans")
      cy.contains("button", "Print", { timeout: 10000 }).should("be.visible")
    })

    it("table shows correct columns", () => {
      cy.viewport(1280, 900)
      cy.visit("/loans")
      cy.contains("Customer Name", { timeout: 10000 }).should("exist")
      cy.contains("Principal Amount").should("exist")
      cy.contains("Principal Balance").should("exist")
      cy.contains("Total Due").should("exist")
      cy.contains("Days Overdue").should("exist")
      cy.contains("Last Payment").should("exist")
    })

    it("shows filter empty state when no loans match", () => {
      cy.visit("/loans")
      // A fresh loan has 0 days overdue, so Critical filter should be empty
      cy.contains("button", /^Critical \(30\+\)/, { timeout: 10000 }).click()
      cy.contains("h2", "No loans in this category.", { timeout: 10000 }).should("be.visible")
      cy.contains("No loans match the selected filter. Try a different category.").should("be.visible")
      cy.contains("button", "Show all loans").should("be.visible")
      cy.contains("button", "Show all loans").click()
      cy.get("[data-testid='data-row']", { timeout: 10000 }).should("exist")
    })

    it("shows a no-match state and clears the customer-name search", () => {
      cy.visit("/loans")
      cy.get("input[placeholder='Search by customer name...']").type("No Such Borrower")
      cy.contains("No loans match your search.", { timeout: 10000 }).should("be.visible")

      cy.contains("button", "Clear filters").first().click()
      cy.get("input[placeholder='Search by customer name...']").should("have.value", "")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
    })

    it("composes customer-name search with the selected risk category", () => {
      cy.visit("/loans")
      cy.contains("button", "Early (0-24 days)", { timeout: 10000 }).click()
      cy.get("input[placeholder='Search by customer name...']").type("Test")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)

      cy.contains("button", "Clear filters").click()
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
      cy.contains("Early (0-24 days)").closest("button").should("have.attr", "aria-pressed", "true")
    })

    // Regression: a same-day payment must not flip a brand-new loan to Critical.
    // Pre-fix bug: allocatePayment charged a full 30 days of interest at day 0,
    // booking ~10% of principal as Interest Earned. The watchlist then divided
    // that figure by the daily rate and reported 30 days overdue. After the fix,
    // pro-rata interest at day 0 is zero, so the entire payment reduces principal
    // and daysOverdue stays at 0.
    it("same-day payment on a new loan does not turn it Critical", () => {
      cy.visit("/loans")
      cy.get("[data-testid='data-row']", { timeout: 10000 })
        .first()
        .click()
      cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-zA-Z0-9-]+$/)
      cy.contains("Record Payment", { timeout: 10000 }).click()
      cy.get("#amount", { timeout: 10000 }).type("100000")
      cy.contains("button", "Record Payment").click()
      cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-zA-Z0-9-]+$/)

      cy.visit("/loans")
      cy.get("[data-testid='data-row']", { timeout: 10000 }).should("exist")
      // The loan must not appear under the Critical (30+) filter.
      cy.contains("Critical (30+ days)", { timeout: 10000 }).closest("button").click()
      cy.contains("h2", "No loans in this category.", { timeout: 10000 }).should("be.visible")
      cy.contains("button", "Show all loans").click()
      // Principal Balance reduced by the full payment (interest = 0 at day 0).
      cy.contains("[data-testid='data-row']", "Test Borrower").within(() => {
        cy.contains("900,000").should("exist")
      })
    })
  })

  context("navigation", () => {
    beforeEach(() => {
      seedCustomerAndLoan("Nav Test Borrower", "0700000002", "500000")
    })

    it("row click navigates to loan detail", () => {
      cy.visit("/loans")
      cy.get("[data-testid='data-row']", { timeout: 10000 }).first().click()
      cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-zA-Z0-9-]+$/)
    })

    it("Customer Name link navigates to customer profile", () => {
      cy.visit("/loans")
      // Click the customer name link specifically (not the row)
      cy.get("[data-testid='data-row']", { timeout: 10000 }).first().within(() => {
        cy.get("a[href^='/customers/']").first().click()
      })
      cy.url({ timeout: 10000 }).should("match", /\/customers\//)
    })

    it("/watchlist returns 404 after deletion", () => {
      cy.request({ url: "/watchlist", failOnStatusCode: false })
        .its("status")
        .should("eq", 404)
    })

    it("sidebar shows Loans but not Watchlist", () => {
      cy.viewport(1280, 800)
      cy.visit("/loans")
      cy.get("[data-testid='sidebar-nav']", { timeout: 10000 }).should("be.visible")
      cy.get("[data-testid='sidebar-nav']").contains("Loans").should("be.visible")
      cy.get("[data-testid='sidebar-nav']").contains("Watchlist").should("not.exist")
    })
  })

  context("customer-name filter with multiple loans", () => {
    beforeEach(() => {
      seedCustomerAndLoan("Alice Filter Borrower", "0700000011", "500000")
      seedCustomerAndLoan("Bob Filter Borrower", "0700000012", "600000")
    })

    it("shows only the matching customer loan", () => {
      cy.visit("/loans")
      cy.contains("Alice Filter Borrower", { timeout: 10000 }).should("be.visible")
      cy.contains("Bob Filter Borrower").should("be.visible")

      cy.get("input[placeholder='Search by customer name...']").type("alice")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
      cy.get("[data-testid='data-row']").filter(":visible").should("contain", "Alice Filter Borrower")
      cy.get("[data-testid='data-row']").filter(":visible").should("not.contain", "Bob Filter Borrower")
    })

    it("uses the filtered rows in the print document", () => {
      cy.visit("/loans")
      cy.get("input[placeholder='Search by customer name...']").type("Alice")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
      cy.get("[data-testid='data-row']").filter(":visible").should("contain", "Alice Filter Borrower")
      cy.contains("button", "Print").click()

      cy.get("iframe", { timeout: 10000 }).should("exist").then(($iframe) => {
        const bodyText = $iframe.contents().find("body").text()
        expect(bodyText).to.contain("Alice Filter Borrower")
        expect(bodyText).not.to.contain("Bob Filter Borrower")
      })
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders card layout at mobile", () => {
      seedCustomerAndLoan("Mobile Borrower", "0700000003", "750000")
      cy.visit("/loans")
      cy.get("[data-slot='table-container']", { timeout: 10000 }).should("not.be.visible")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
    })

    it("shows tab bar at mobile", () => {
      cy.visit("/loans")
      cy.get("[data-testid='bottom-tab-bar']", { timeout: 10000 }).should("exist")
        .and("have.css", "display", "flex")
    })

    it("reveals the customer-name filter from the mobile filter toggle", () => {
      cy.visit("/loans")
      cy.get("[aria-label='Toggle filters']", { timeout: 10000 }).should("be.visible")
      cy.get("[data-slot='filter-panel-content']").should("not.be.visible")
      cy.get("[aria-label='Toggle filters']").click()
      cy.get("input[placeholder='Search by customer name...']").should("be.visible")
    })
  })
})
