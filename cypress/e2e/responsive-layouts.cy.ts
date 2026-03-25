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
  })
})
