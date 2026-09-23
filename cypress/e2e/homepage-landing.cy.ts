describe("Logged-out home landing page", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearCookies()
  })

  it("renders the public landing page for a first-time visitor", () => {
    cy.visit("/home")

    cy.contains("Lending, with clarity").should("be.visible")
    cy.get("h1").should("contain", "Make every shilling move with purpose")
    cy.contains("Portfolio visibility").should("be.visible")
    cy.contains("Record the loan").should("be.visible")
    cy.get("footer").should("contain", "Kaks Credit")
    cy.get(".home-page").should(($page) => {
      const pageStyles = getComputedStyle($page[0])
      expect(pageStyles.backgroundColor).not.to.equal("rgb(246, 242, 234)")
    })
    cy.get(".home-pill-ink").should(($button) => {
      expect(getComputedStyle($button[0]).backgroundColor).not.to.equal("rgb(31, 45, 39)")
    })
  })

  it("routes sign-in and request-access actions to their pages", () => {
    cy.visit("/home")

    cy.get('a[href="/login"]').first().click()
    cy.url().should("include", "/login")

    cy.visit("/home")
    cy.get('a[href="/request-access"]').first().click()
    cy.url().should("include", "/request-access")
    cy.contains("h1", "Request access").should("be.visible")
  })

  it("sends a returning logged-out visitor to sign in", () => {
    cy.setCookie("has_account", "1")

    cy.visit("/home")

    cy.url().should("include", "/login")
    cy.contains("Sign in to Kaks Credit").should("be.visible")
  })

  it("keeps similarly named routes behind the normal auth gate", () => {
    cy.visit("/home/anything")

    cy.url().should("include", "/register")
  })

  it("stays readable and keeps actions available on mobile", () => {
    cy.viewport(390, 844)
    cy.visit("/home")

    cy.get("h1").should("be.visible")
    cy.get('a[href="/login"]').first().should("be.visible")
    cy.get('a[href="/request-access"]').first().should("be.visible")
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.lte(
        document.documentElement.clientWidth + 1,
      )
    })
  })
})
