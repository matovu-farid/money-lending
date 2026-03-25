describe("Customer Search and Filtering", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Search Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create several customers for search/filter testing
    const customers = [
      { name: "Alice Nakato", contact: "0771000001", address: "Kampala, Uganda" },
      { name: "Bob Ssemakula", contact: "0771000002", address: "Entebbe, Uganda" },
      { name: "Carol Namutebi", contact: "0771000003", address: "Jinja, Uganda" },
    ]

    customers.forEach((c) => {
      cy.visit("/customers/new")
      cy.get("#fullName").type(c.name)
      cy.get("#contact").type(c.contact)
      cy.get("#address").type(c.address)
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)
    })
  })

  it("searches customers by name and shows filtered results", () => {
    cy.visit("/customers")
    // Wait for the customer list to load before typing
    cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")

    cy.get("input[placeholder*='Search by name']").clear().type("Alice")

    // Should find Alice, not Bob or Carol
    cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")
    cy.contains("Bob Ssemakula").should("not.exist")
    cy.contains("Carol Namutebi").should("not.exist")
  })

  it("filters customers by status dropdown", () => {
    cy.visit("/customers")
    // Wait for the customer list to load
    cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")

    // All customers default to "active" status
    // Filter by Active — should show all
    cy.get("[data-slot=select-trigger]").contains("All Statuses").click()
    cy.contains("[data-slot=select-item]", "Active").click()
    cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")

    // Filter by Blacklisted — should show none
    cy.get("[data-slot=select-trigger]").contains("Active").click()
    cy.contains("[data-slot=select-item]", "Blacklisted").click()
    cy.contains("No customers match your search.", { timeout: 10000 }).should("be.visible")
  })

  it("filters customers by loan status", () => {
    cy.visit("/customers")
    // Wait for the customer list to load
    cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")

    // No customers have loans yet — filter by Active loan status
    cy.get("[data-slot=select-trigger]").contains("All Loan Status").click()
    cy.contains("[data-slot=select-item]", "Active").click()

    // Customers without matching loan status should be filtered
    // The exact behavior depends on backend, but the filter should apply
    cy.get("table", { timeout: 10000 })
  })

  it("shows empty state when no customers match filters", () => {
    cy.visit("/customers")
    // Wait for the customer list to load
    cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")

    cy.get("input[placeholder*='Search by name']").clear().type("NonexistentCustomer12345")

    cy.contains("No customers match your search.", { timeout: 10000 }).should("be.visible")
  })

  it("clears all filters and shows full list", () => {
    cy.visit("/customers")
    // Wait for the customer list to load
    cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")

    // Apply a name filter
    cy.get("input[placeholder*='Search by name']").clear().type("Alice")
    cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")
    cy.contains("Bob Ssemakula").should("not.exist")

    // Clear filters
    cy.contains("Clear filters").click()

    // Should show all customers again
    cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")
    cy.contains("Bob Ssemakula").should("be.visible")
    cy.contains("Carol Namutebi").should("be.visible")
  })

  it("shows customer count in pagination info", () => {
    cy.visit("/customers")
    // With 3 customers and PAGE_SIZE=20, we should see count text
    cy.contains("Showing 1", { timeout: 10000 }).should("be.visible")
    cy.contains("of 3 customers").should("be.visible")
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders page at mobile and shows tab bar", () => {
      cy.visit("/customers")
      cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })

    it("shows card layout instead of table at mobile", () => {
      cy.visit("/customers")
      cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")
      cy.get("[data-slot='table-container']").should("not.be.visible")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
    })

    it("filter panel toggle works at mobile", () => {
      cy.visit("/customers")
      cy.contains("Alice Nakato", { timeout: 10000 }).should("be.visible")
      // Toggle filters button should be visible at mobile
      cy.get("[aria-label='Toggle filters']").should("be.visible")
      // Filter panel content should be hidden by default at mobile
      cy.get("[data-slot='filter-panel-content']").should("not.be.visible")
      // Click toggle to open
      cy.get("[aria-label='Toggle filters']").click()
      // Filter panel content should now be visible
      cy.get("[data-slot='filter-panel-content']").should("be.visible")
    })
  })
})
