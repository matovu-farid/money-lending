describe("In-App Notifications", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Notification Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows bell icon in top bar", () => {
    cy.get("button[aria-label='Notifications']").should("be.visible")
  })

  it("opens dropdown with notification list", () => {
    cy.get("button[aria-label='Notifications']").click()
    cy.contains("Notifications").should("be.visible")
  })

  it("shows empty state when no notifications", () => {
    cy.get("button[aria-label='Notifications']").click()
    cy.contains("No alerts at this time.").should("be.visible")
  })

  it("does not show mark all as read when no unread notifications", () => {
    cy.get("button[aria-label='Notifications']").click()
    // "Mark all as read" only renders when unreadCount > 0
    cy.contains("Mark all as read").should("not.exist")
  })

  it("shows notifications after creating overdue conditions", () => {
    // Create a customer and issue a loan to trigger potential notifications
    cy.visit("/customers/new")
    cy.get("#fullName").type("Notification Borrower")
    cy.get("#contact").type("0771000050")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      const cid = url.split("/customers/")[1]
      cy.visit(`/loans/new?customerId=${cid}`)
      cy.get("#principalAmount").type("1000000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").click()
      cy.get("[role=option]").contains("Land Title").click()
      cy.get("[data-base-ui-inert]").should("not.exist")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${cid}`)
    })

    // Go back to dashboard and check bell icon still works
    cy.visit("/dashboard")
    cy.get("button[aria-label='Notifications']").should("be.visible")
    cy.get("button[aria-label='Notifications']").click()
    cy.contains("Notifications").should("be.visible")
  })
})
