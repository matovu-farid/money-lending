describe("Customer CRUD", () => {
  beforeEach(() => {
    cy.task("db:reset")

    // Register first user (superAdmin)
    cy.registerAndLogin({ name: "Admin User" })

    // SuperAdmin lands on dashboard
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  describe("Customer List", () => {
    it("shows empty state when no customers exist", () => {
      cy.visit("/customers")
      cy.contains("No customers yet")
      cy.contains("Register").should("be.visible")
    })

    it("Add Customer button navigates to /customers/new", () => {
      cy.visit("/customers")
      cy.contains("Add Customer").click()
      cy.url().should("include", "/customers/new")
    })
  })

  describe("Customer Registration", () => {
    it("registers a customer and redirects to profile", () => {
      cy.visit("/customers/new")
      cy.contains("Register Customer")

      cy.get("#fullName").type("John Doe")
      cy.get("#contact").type("0771234567")
      cy.get("#address").type("Kampala, Uganda")

      cy.contains("button", "Register Customer").click()

      // Should redirect to customer profile
      cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)
      cy.contains("John Doe")
      cy.contains("0771234567")
      cy.contains("Kampala, Uganda")
    })

    it("shows validation errors for empty fields", () => {
      cy.visit("/customers/new")

      cy.contains("button", "Register Customer").click()

      cy.contains("Full name is required")
      cy.contains("Contact is required")
      cy.contains("Address is required")
    })

    it("cancel button navigates back to customers list", () => {
      cy.visit("/customers/new")
      cy.contains("Cancel").click()
      cy.url().should("include", "/customers")
      cy.url().should("not.include", "/new")
    })
  })

  describe("Customer Profile", () => {
    beforeEach(() => {
      // Create a customer first
      cy.visit("/customers/new")
      cy.get("#fullName").type("Jane Smith")
      cy.get("#contact").type("0787654321")
      cy.get("#address").type("Entebbe, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)
    })

    it("displays customer info with status badge", () => {
      cy.contains("Jane Smith")
      cy.contains("0787654321")
      cy.contains("Entebbe, Uganda")
      // Status is shown via a Select dropdown — the trigger displays "Active"
      cy.get("[data-slot='select-trigger']").should("contain.text", "Active")
    })

    it("shows Issue New Loan button linking to loan wizard", () => {
      cy.contains("Issue New Loan").should("be.visible")
      cy.contains("Issue New Loan").click()
      cy.url().should("include", "/loans/new")
      cy.url().should("include", "customerId=")
    })

    it("edits customer info inline and persists changes", () => {
      cy.contains("button", "Edit").click()

      // Edit fields should appear
      cy.get("#edit-fullName").clear().type("Jane Updated")
      cy.get("#edit-contact").clear().type("0700000000")

      cy.contains("button", "Save").click()

      // Should show updated info
      cy.contains("Jane Updated")
      cy.contains("0700000000")

      // Verify persistence on reload
      cy.reload()
      cy.contains("Jane Updated")
      cy.contains("0700000000")
    })

    it("cancel edit reverts changes", () => {
      cy.contains("button", "Edit").click()
      cy.get("#edit-fullName").clear().type("Should Not Save")
      cy.contains("button", "Cancel").click()

      // Should still show original name
      cy.contains("Jane Smith")
      cy.contains("Should Not Save").should("not.exist")
    })

    it("shows 'No active loans' when customer has no loans", () => {
      cy.contains("No loans on record for this customer.").should("be.visible")
    })
  })

  describe("Customer List with Data", () => {
    it("shows customers in table after registration", () => {
      // Register a customer
      cy.visit("/customers/new")
      cy.get("#fullName").type("Alice Test")
      cy.get("#contact").type("0712345678")
      cy.get("#address").type("Jinja, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

      // Navigate to list
      cy.visit("/customers")
      cy.contains("Alice Test")
      cy.contains("0712345678")
    })

    it("row click navigates to customer profile", () => {
      // Register a customer
      cy.visit("/customers/new")
      cy.get("#fullName").type("Bob Click")
      cy.get("#contact").type("0723456789")
      cy.get("#address").type("Mbarara, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

      cy.visit("/customers")
      cy.contains("Bob Click").click()
      cy.url().should("match", /\/customers\/.+/)
      cy.contains("Bob Click")
      cy.contains("Customer Profile")
    })
  })
})
