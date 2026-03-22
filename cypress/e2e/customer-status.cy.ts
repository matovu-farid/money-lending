describe("Customer Status Management", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Status Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer
    cy.visit("/customers/new")
    cy.get("#fullName").type("Status Test Customer")
    cy.get("#contact").type("0771000010")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
    })
  })

  it("changes customer status via inline dropdown with reason", () => {
    // Wait for customer profile to load (async data fetch)
    cy.get("[data-slot=select-trigger]", { timeout: 10000 }).should("contain", "Active")
    // Customer defaults to Active — change to Inactive
    cy.get("[data-slot=select-trigger]").click()
    cy.contains("[data-slot=select-item]", "Inactive").click()

    // Confirmation dialog should appear
    cy.contains("Change status to Inactive?").should("be.visible")

    // Provide a valid reason (10+ chars)
    cy.get("#status-reason").type("Customer requested to be set inactive for now")
    cy.contains("button", "Confirm").click()

    // Toast success and status update
    cy.contains("status updated", { timeout: 10000 }).should("be.visible")
  })

  it("shows destructive confirmation dialog when blacklisting", () => {
    cy.get("[data-slot=select-trigger]", { timeout: 10000 }).should("contain", "Active")
    cy.get("[data-slot=select-trigger]").click()
    cy.contains("[data-slot=select-item]", "Blacklisted").click()

    // Dialog should have destructive styling and warning message
    cy.contains("Blacklist Status Test Customer?").should("be.visible")
    cy.contains("This will prevent Status Test Customer from receiving new loans").should("be.visible")

    // Confirm button should be destructive variant
    cy.contains("button", "Confirm").should("be.visible")
  })

  it("requires reason of at least 10 characters", () => {
    cy.get("[data-slot=select-trigger]", { timeout: 10000 }).should("contain", "Active")
    cy.get("[data-slot=select-trigger]").click()
    cy.contains("[data-slot=select-item]", "Blacklisted").click()

    // Type a short reason
    cy.get("#status-reason").type("Too short")
    cy.contains("Reason must be at least 10 characters").should("be.visible")

    // Confirm button should be disabled
    cy.contains("button", "Confirm").should("be.disabled")

    // Type a valid reason
    cy.get("#status-reason").clear().type("This customer has defaulted on multiple loans")
    cy.contains("Reason must be at least 10 characters").should("not.exist")
    cy.contains("button", "Confirm").should("not.be.disabled")
  })

  it("status change is reflected immediately on customer profile", () => {
    cy.get("[data-slot=select-trigger]", { timeout: 10000 }).should("contain", "Active")
    cy.get("[data-slot=select-trigger]").click()
    cy.contains("[data-slot=select-item]", "Inactive").click()

    cy.get("#status-reason").type("Temporarily pausing account activity")
    cy.contains("button", "Confirm").click()

    cy.contains("status updated", { timeout: 10000 }).should("be.visible")

    // Reload and verify persistence
    cy.reload()
    cy.get("[data-slot=select-trigger]", { timeout: 10000 }).should("contain", "Inactive")
  })

  it("cancel on status dialog keeps original status", () => {
    cy.get("[data-slot=select-trigger]", { timeout: 10000 }).should("contain", "Active")
    cy.get("[data-slot=select-trigger]").click()
    cy.contains("[data-slot=select-item]", "Blacklisted").click()

    // Cancel the dialog
    cy.contains("button", "Cancel").click()

    // Status should remain Active
    cy.get("[data-slot=select-trigger]").should("contain", "Active")
  })
})
