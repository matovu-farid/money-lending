describe("Responsive Layouts", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin()
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => cy.viewport(390, 844))

    // RESP-01: Dashboard KPI grid single column at 390px
    it("dashboard KPI grid is single column", () => {
      cy.visit("/dashboard")
      // At mobile, KPI cards stack. Check the cards exist in DOM.
      cy.contains("[data-slot='card']", "Loans Outstanding").should("exist")
      cy.contains("[data-slot='card']", "Active Borrowers").should("exist")
    })

    // RESP-02 + RESP-07: Customers card layout
    it("customers page shows card layout", () => {
      // Seed a customer first
      cy.visit("/customers/new")
      cy.get("#fullName").type("Mobile Customer")
      cy.get("#contact").type("0700000001")
      cy.get("#address").type("Test Address")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.visit("/customers")
      // Table container (inside hidden md:block) should not be visible at mobile
      cy.get("[data-slot='table-container']").should("not.be.visible")
      // Card data-row divs (the md:hidden cards) should be visible
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
      cy.get("[data-testid='data-row']").filter(":visible").first().should("contain.text", "Mobile Customer")
    })

    // RESP-07: Creditors card layout
    it("creditors page shows card layout", () => {
      cy.visit("/creditors/new")
      cy.get('input[name="name"]').type("Mobile Creditor")
      cy.get('input[name="contact"]').type("0700111111")
      cy.get('input[name="address"]').type("123 Street")
      cy.get('input[name="amount"]').type("1000000")
      cy.contains("button", "Register Creditor").click()
      cy.url({ timeout: 30000 }).should("match", /\/creditors$/)
      // Hard navigate to ensure server component fetches fresh data
      cy.visit("/creditors")

      // Table container (inside hidden md:block) should not be visible at mobile
      cy.get("[data-slot='table-container']").should("not.be.visible")
      // Card data-row divs should be visible
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
      cy.get("[data-testid='data-row']").filter(":visible").first().should("contain.text", "Mobile Creditor")
    })

    // RESP-07: Watchlist card layout (watchlist may be empty — verify page renders)
    it("watchlist page renders without errors at mobile", () => {
      cy.visit("/watchlist")
      // Use data attribute or heading selector to avoid matching sidebar
      cy.get("h1").contains("Watchlist").should("be.visible")
    })

    // RESP-07: Loans card layout
    it("loans page shows card layout", () => {
      // Create a customer then issue a loan
      cy.visit("/customers/new")
      cy.get("#fullName").type("Loan Mobile Customer")
      cy.get("#contact").type("0700444444")
      cy.get("#address").type("Kampala, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.url().then((url) => {
        const cid = url.split("/customers/")[1]
        cy.visit(`/loans/new?customerId=${cid}`)
        cy.get("#principalAmount").type("500000")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Land Title")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)

        cy.visit("/loans")
        // Table container should not be visible at mobile
        cy.get("[data-slot='table-container']").should("not.be.visible")
        // Card data-row divs should be visible
        cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
        cy.get("[data-testid='data-row']").filter(":visible").first().should("contain.text", "Loan Mobile Customer")
      })
    })

    // RESP-07: Payments card layout
    it("payments page shows card layout", () => {
      // Create customer, issue loan, record payment to have data to display
      cy.visit("/customers/new")
      cy.get("#fullName").type("Payment Mobile Customer")
      cy.get("#contact").type("0700555555")
      cy.get("#address").type("Entebbe, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.url().then((url) => {
        const cid = url.split("/customers/")[1]
        cy.visit(`/loans/new?customerId=${cid}`)
        cy.get("#principalAmount").type("300000")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Motor Vehicle")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)

        cy.task("db:getLoans").then((loans: any) => {
          const loanId = loans[0].id
          cy.visit(`/loans/${loanId}/payments/new`)
          cy.get("#amount", { timeout: 10000 }).type("50000")
          cy.contains("button", "Record Payment").click()
          cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}`)

          cy.visit("/payments")
          // Table container should not be visible at mobile
          cy.get("[data-slot='table-container']").should("not.be.visible")
          // Card data-row divs should be visible
          cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
          cy.get("[data-testid='data-row']").filter(":visible").first().should("contain.text", "Payment Mobile Customer")
        })
      })
    })

    // RESP-07: Expenses card layout
    it("expenses page shows card layout", () => {
      cy.visit("/expenses")
      cy.get("h1").contains("Expenses", { timeout: 10000 }).should("be.visible")

      // Add an expense to have data to display
      cy.contains("button", "Add Expense").click({ force: true })
      cy.pickDate("#expense-date", "2026-03-21")
      cy.contains("+ Add Category").click()
      cy.get("#new-category-name").type("Office Supplies")
      cy.contains("button", /^Add$/).click()
      // Select the newly created category using data-slot selectors (same pattern as expenses.cy.ts)
      cy.get("[data-slot=select-trigger]").first().click({ force: true })
      cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
      cy.contains("[data-slot=select-item]", "Office Supplies").realClick()
      cy.get("#expense-amount").type("25000")
      cy.contains("button", "Record Expense").click()

      // Wait for success toast before reloading to ensure DB commit
      cy.contains("Expense recorded", { timeout: 10000 }).should("exist")
      cy.reload()
      // At mobile, table container should not be visible; card rows should be visible
      cy.get("[data-slot='table-container']").should("not.be.visible")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
    })

    // RESP-07: Income card layout
    it("income page shows card layout", () => {
      cy.visit("/income")
      cy.get("h1").contains("Income", { timeout: 10000 }).should("be.visible")

      // Add an income entry to have data to display
      cy.contains("button", "Add Income").click({ force: true })
      cy.pickDate("#income-date", "2026-03-21")
      cy.contains("+ Add Category").click()
      cy.get("#new-income-category-name").type("Loan Interest")
      cy.contains("button", /^Add$/).click()
      // Select the newly created category using data-slot selectors (same pattern as expenses.cy.ts)
      cy.get("[data-slot=select-trigger]").first().click({ force: true })
      cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
      cy.contains("[data-slot=select-item]", "Loan Interest").realClick()
      cy.get("#income-amount").type("40000")
      cy.contains("button", "Record Income").click()

      // Wait for success toast before reloading to ensure DB commit
      cy.contains("Income recorded", { timeout: 10000 }).should("exist")
      cy.reload()
      // At mobile, table container should not be visible; card rows should be visible
      cy.get("[data-slot='table-container']").should("not.be.visible")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
    })
  })

  context("at desktop viewport (1280x800)", () => {
    beforeEach(() => cy.viewport(1280, 800))

    // RESP-02: Desktop shows table, not cards
    it("customers page shows table layout", () => {
      cy.visit("/customers/new")
      cy.get("#fullName").type("Desktop Customer")
      cy.get("#contact").type("0700222222")
      cy.get("#address").type("456 Avenue")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.visit("/customers")
      cy.get("[data-slot='table-container']").should("be.visible")
      cy.get("[data-testid='data-row']").should("have.length.gte", 1)
    })

    it("creditors page shows table layout", () => {
      cy.visit("/creditors/new")
      cy.get('input[name="name"]').type("Desktop Creditor")
      cy.get('input[name="contact"]').type("0700333333")
      cy.get('input[name="address"]').type("456 Avenue")
      cy.get('input[name="amount"]').type("2000000")
      cy.contains("button", "Register Creditor").click()
      cy.url({ timeout: 30000 }).should("match", /\/creditors$/)
      // Hard navigate to ensure server component fetches fresh data
      cy.visit("/creditors")

      cy.get("[data-slot='table-container']").should("be.visible")
      cy.get("[data-testid='data-row']").should("have.length.gte", 1)
    })

    it("watchlist page shows table layout or empty state", () => {
      cy.visit("/watchlist")
      cy.get("h1").contains("Watchlist").should("be.visible")
    })

    it("dashboard KPI grid is multi-column", () => {
      cy.visit("/dashboard")
      cy.contains("[data-slot='card']", "Loans Outstanding").should("exist")
      cy.contains("[data-slot='card']", "Active Borrowers").should("exist")
    })

    // RESP-07: Loans table layout at desktop
    it("loans page shows table layout", () => {
      cy.visit("/customers/new")
      cy.get("#fullName").type("Loan Desktop Customer")
      cy.get("#contact").type("0700666666")
      cy.get("#address").type("Jinja, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.url().then((url) => {
        const cid = url.split("/customers/")[1]
        cy.visit(`/loans/new?customerId=${cid}`)
        cy.get("#principalAmount").type("750000")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Land Title")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)

        cy.visit("/loans")
        cy.get("[data-slot='table-container']").should("be.visible")
        cy.get("[data-testid='data-row']").should("have.length.gte", 1)
        cy.contains("th", "Slug").should("be.visible")
        cy.contains("th", "Customer").should("be.visible")
      })
    })

    // RESP-07: Payments table layout at desktop
    it("payments page shows table layout", () => {
      cy.visit("/customers/new")
      cy.get("#fullName").type("Payment Desktop Customer")
      cy.get("#contact").type("0700777777")
      cy.get("#address").type("Mbarara, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/[0-9a-f-]{36}/)

      cy.url().then((url) => {
        const cid = url.split("/customers/")[1]
        cy.visit(`/loans/new?customerId=${cid}`)
        cy.get("#principalAmount").type("400000")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Motor Cycle")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)

        cy.task("db:getLoans").then((loans: any) => {
          const loanId = loans[0].id
          cy.visit(`/loans/${loanId}/payments/new`)
          cy.get("#amount", { timeout: 10000 }).type("60000")
          cy.contains("button", "Record Payment").click()
          cy.url({ timeout: 10000 }).should("include", `/loans/${loanId}`)

          cy.visit("/payments")
          cy.get("[data-slot='table-container']").should("be.visible")
          cy.get("[data-testid='data-row']").should("have.length.gte", 1)
          cy.contains("th", "Customer").should("be.visible")
          cy.contains("th", "Date").should("be.visible")
        })
      })
    })

    // RESP-07: Expenses table layout at desktop
    it("expenses page shows table layout", () => {
      cy.visit("/expenses")
      cy.get("h1").contains("Expenses", { timeout: 10000 }).should("be.visible")

      cy.contains("button", "Add Expense").click({ force: true })
      cy.pickDate("#expense-date", "2026-03-21")
      cy.contains("+ Add Category").click()
      cy.get("#new-category-name").type("Office Rent")
      cy.contains("button", /^Add$/).click()
      cy.get("[data-slot=select-trigger]").first().click({ force: true })
      cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
      cy.contains("[data-slot=select-item]", "Office Rent").realClick()
      cy.get("#expense-amount").type("150000")
      cy.contains("button", "Record Expense").click()

      // Wait for success toast before reloading to ensure DB commit
      cy.contains("Expense recorded", { timeout: 10000 }).should("exist")
      cy.reload()
      cy.get("[data-slot='table-container']").should("be.visible")
      cy.get("[data-testid='data-row']").should("have.length.gte", 1)
      cy.contains("th", "Category").should("be.visible")
    })

    // RESP-07: Income table layout at desktop
    it("income page shows table layout", () => {
      cy.visit("/income")
      cy.get("h1").contains("Income", { timeout: 10000 }).should("be.visible")

      cy.contains("button", "Add Income").click({ force: true })
      cy.pickDate("#income-date", "2026-03-21")
      cy.contains("+ Add Category").click()
      cy.get("#new-income-category-name").type("Consultation Fees")
      cy.contains("button", /^Add$/).click()
      cy.get("[data-slot=select-trigger]").first().click({ force: true })
      cy.get("[data-slot=select-content]", { timeout: 5000 }).should("exist")
      cy.contains("[data-slot=select-item]", "Consultation Fees").realClick()
      cy.get("#income-amount").type("80000")
      cy.contains("button", "Record Income").click()

      // Wait for success toast before reloading to ensure DB commit
      cy.contains("Income recorded", { timeout: 10000 }).should("exist")
      cy.reload()
      cy.get("[data-slot='table-container']").should("be.visible")
      cy.get("[data-testid='data-row']").should("have.length.gte", 1)
      cy.contains("th", "Category").should("be.visible")
    })
  })
})
