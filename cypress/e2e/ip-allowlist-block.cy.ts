const TEST_IP = "::ffff:127.0.0.1"

describe("IP allowlist — enforcement", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.clearIpCaches()
  })

  it("supervisor is redirected to /access-blocked when toggle is on and IP is not trusted", () => {
    cy.registerAndLogin({ name: "Admin User" }).then((adminEmail) => {
      cy.task("db:promoteUser", { email: adminEmail, role: "admin" })
    })

    cy.task("auth:createUser", { name: "Sup", role: "supervisor" }).then((sup: any) => {
      cy.setIpAllowlistEnabled(true)
      cy.loginAsTestUser(sup.cookies)
      cy.visit("/dashboard")
      cy.url({ timeout: 15000 }).should("include", "/access-blocked")
      cy.contains("Access Blocked").should("be.visible")
    })
  })

  it("admin is exempt — can sign in even from an untrusted IP", () => {
    cy.task("auth:createUser", { name: "Admin", role: "admin" }).then((u: any) => {
      cy.setIpAllowlistEnabled(true)
      cy.clearAllowlist()
      cy.loginAsTestUser(u.cookies)
      cy.visit("/dashboard")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })
  })

  it("supervisor passes when their IP is in the allowlist", () => {
    cy.task("auth:createUser", { name: "Admin", role: "admin" }).then((admin: any) => {
      cy.task("auth:createUser", { name: "Sup", role: "supervisor" }).then((sup: any) => {
        cy.setIpAllowlistEnabled(true)
        cy.seedAllowlistEntry(admin.userId, TEST_IP)
        cy.loginAsTestUser(sup.cookies)
        cy.visit("/dashboard")
        cy.url({ timeout: 15000 }).should("include", "/dashboard")
      })
    })
  })

  it("toggling off lets supervisor in immediately", () => {
    cy.task("auth:createUser", { name: "Sup", role: "supervisor" }).then((sup: any) => {
      cy.setIpAllowlistEnabled(true)
      cy.clearAllowlist()
      cy.loginAsTestUser(sup.cookies)
      cy.visit("/dashboard")
      cy.url({ timeout: 15000 }).should("include", "/access-blocked")

      cy.setIpAllowlistEnabled(false)
      // Cache TTL is 30s; wait beyond it
      cy.wait(31_000)
      cy.visit("/dashboard")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })
  })
})
