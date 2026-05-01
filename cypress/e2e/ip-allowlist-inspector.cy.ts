describe("IP allowlist — inspector actions", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.clearIpCaches()
  })

  it("admin can remove an allowlist entry", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.task("auth:createUser", { name: "Other Admin", role: "admin" }).then((other: any) => {
        cy.seedAllowlistEntry(other.userId, "203.0.113.7")
        cy.clearCookies()
        cy.login(adminEmail, "TestPass123!")
        cy.visit("/admin")
        // Wait for the page content to load (Electric sync may take a moment)
        cy.get('[data-testid="ip-allowlist-view-button"]', { timeout: 20000 }).should("be.visible").click()
        // Find the row for 203.0.113.7 specifically and click its Remove button
        cy.get('[data-testid="allowlist-row"]').contains("203.0.113.7").closest('[data-testid="allowlist-row"]').within(() => {
          cy.contains("Remove").click()
        })
        cy.contains("IP removed", { timeout: 8000 }).should("be.visible")
        cy.countAllowlistFor(other.userId).should("eq", 0)
      })
    })
  })

  it("clear-all wipes the allowlist", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.task("auth:createUser", { name: "Other Admin", role: "admin" }).then((other: any) => {
        cy.seedAllowlistEntry(other.userId, "203.0.113.7")
        cy.seedAllowlistEntry(other.userId, "203.0.113.8")
        cy.clearCookies()
        cy.login(adminEmail, "TestPass123!")
        cy.visit("/admin")
        cy.get('[data-testid="ip-allowlist-view-button"]', { timeout: 20000 }).should("be.visible").click()
        cy.get('[data-testid="tab-danger"]').click()
        cy.get('[data-testid="clear-all-button"]').click()
        cy.get('[data-testid="clear-all-confirm"]').should("be.visible").click()
        cy.contains("All IPs cleared", { timeout: 15000 }).should("be.visible")
        cy.countAllowlistFor(other.userId).should("eq", 0)
      })
    })
  })
})
