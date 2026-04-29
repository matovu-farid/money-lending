describe("Optimistic Customer Creation", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Loan Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("instantly navigates to customer detail page after creation", () => {
    cy.visit("/customers/new")

    // Fill form fields
    cy.get("#fullName").type("John Mukasa")
    cy.get("#nin").type("C1234567890123")
    cy.get("#contact").type("0771234567")
    cy.get("#address").type("Kampala, Uganda")

    // Submit
    cy.contains("button", "Register Customer").click()

    // Should navigate to /customers/{uuid} pattern immediately (optimistic)
    cy.url({ timeout: 10000 }).should("match", /\/customers\/[a-f0-9-]+$/)

    // Give the async server action time to persist
    // eslint-disable-next-line cypress/no-unnecessary-waiting
    cy.wait(5000)

    // Verify the customer was persisted to the database
    cy.task("db:getCustomers").then((customers: any) => {
      const match = customers.find(
        (c: any) => c.full_name === "John Mukasa"
      )
      expect(match).to.exist
      expect(match.contact).to.equal("0771234567")
      expect(match.address).to.equal("Kampala, Uganda")
    })
  })

  it("rolls back optimistic data when server action fails", () => {
    cy.visit("/customers/new")

    // Fill form fields first
    cy.get("#fullName").type("Failed Customer")
    cy.get("#nin").type("C1234567890123")
    cy.get("#contact").type("0771234567")
    cy.get("#address").type("Kampala, Uganda")

    // Set up intercept right before submit — this ensures page load requests are not affected
    cy.intercept("POST", "**", (req) => {
      if (req.headers["next-action"]) {
        req.reply({ statusCode: 500, body: "Internal Server Error" })
      }
    }).as("failedCreate")

    // Submit
    cy.contains("button", "Register Customer").click()

    // Optimistic navigation happens to /customers/{id}
    cy.url({ timeout: 10000 }).should("match", /\/customers\/[a-f0-9-]+$/)

    // After rollback, the customer detail page should show "Customer not found"
    // and the user should see an error or be redirected
    cy.contains(/Customer not found|Failed|error/i, { timeout: 15000 }).should(
      "be.visible"
    )

    // Verify the customer was NOT persisted in the database
    cy.task("db:getCustomers").then((customers: any) => {
      const match = customers.find(
        (c: any) => c.full_name === "Failed Customer"
      )
      expect(match).to.not.exist
    })
  })
})
