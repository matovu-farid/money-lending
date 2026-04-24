describe("Change Name", () => {
  const password = "TestPass123!"

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Original Name", password })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("opens change name dialog from sidebar", () => {
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.contains("Change Name")
    cy.get("input#userName").should("have.value", "Original Name")
  })

  it("updates the user name successfully", () => {
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.get("input#userName").clear().type("New Name")
    cy.contains("button", "Save").click()
    cy.contains("Name updated")
    // Sidebar shows updated name
    cy.get("aside").contains("New Name")
  })

  it("disables save when name is empty", () => {
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.get("input#userName").clear()
    cy.contains("button", "Save").should("be.disabled")
  })

  it("resets name on cancel", () => {
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.get("input#userName").clear().type("Temporary")
    cy.contains("button", "Cancel").click()
    // Reopen — should show original name
    cy.get("aside").find("button[aria-label='Change name']").click()
    cy.get("input#userName").should("have.value", "Original Name")
  })
})
