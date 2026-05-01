interface TestUser {
  email: string
  userId: string
  role: string
  cookies: Array<{ name: string; value: string; domain?: string; path?: string }>
}

describe("IP allowlist — toggle and inspector visibility", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.clearIpCaches()
  })

  it("admin sees toggle on /admin; supervisor does not", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.clearCookies()
      cy.login(adminEmail, "TestPass123!")
      cy.visit("/admin")
      cy.get('[data-testid="ip-allowlist-toggle"]', { timeout: 20000 }).should("be.visible")
      cy.get('[data-testid="ip-allowlist-view-button"]').should("be.visible")
    })

    cy.clearAppPersistence()

    cy.task<TestUser>("auth:createUser", { name: "Sup", role: "supervisor" }).then((u) => {
      cy.loginAsTestUser(u.cookies)
      cy.visit("/admin")
      cy.get('[data-testid="ip-allowlist-toggle"]').should("not.exist")
    })
  })

  it("toggle persists across reload", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.clearCookies()
      cy.login(adminEmail, "TestPass123!")
      cy.visit("/admin")
      // Wait for the toggle to be fully loaded (unchecked state)
      cy.get('[data-testid="ip-allowlist-toggle"]', { timeout: 20000 }).should("have.attr", "data-unchecked")
      cy.get('[data-testid="ip-allowlist-toggle"]').click()
      // Wait for toggle to reflect enabled state, then verify toast
      cy.get('[data-testid="ip-allowlist-toggle"]', { timeout: 10000 }).should("have.attr", "data-checked")
      cy.contains("IP restriction enabled", { timeout: 8000 }).should("be.visible")
      // Wait briefly for the mutation to fully settle before reload
      cy.wait(500)
      cy.reload()
      cy.get('[data-testid="ip-allowlist-toggle"]', { timeout: 20000 }).should("have.attr", "data-checked")
    })
  })

  it("View allowlist sheet opens and shows tabs", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
      cy.clearCookies()
      cy.login(adminEmail, "TestPass123!")
      cy.visit("/admin")
      cy.get('[data-testid="ip-allowlist-view-button"]', { timeout: 20000 }).should("be.visible").click()
      cy.get('[data-testid="ip-allowlist-sheet"]').should("be.visible")
      cy.get('[data-testid="tab-trusted"]').should("be.visible")
      cy.get('[data-testid="tab-blocks"]').should("be.visible")
      cy.get('[data-testid="tab-danger"]').should("be.visible")
    })
  })
})
