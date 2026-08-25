describe("Request access lead form", () => {
  beforeEach(() => {
    cy.visit("/request-access")
  })

  it("renders a lightweight password-free contact form", () => {
    cy.get("h1").should("have.text", "Request access")
    cy.get("#name").should("be.visible")
    cy.get("#email").should("be.visible")
    cy.get("#phone").should("be.visible")
    cy.get("#organization").should("be.visible")
    cy.get("#message").should("be.visible")
    cy.contains("button", "Send request").should("be.visible")
    cy.get('input[type="password"]').should("not.exist")
    cy.contains("a", "Sign in").should("have.attr", "href", "/login")
  })

  it("requires a contact method without leaving the page", () => {
    cy.get("#name").type("Amina Namusoke")
    cy.contains("button", "Send request").click()

    cy.contains("Please provide an email address or phone/WhatsApp number.")
      .should("be.visible")
    cy.contains("button", "Send request").should("be.visible")
    cy.location("pathname").should("eq", "/request-access")
  })

  it("routes the landing-page request access CTA to this form", () => {
    cy.visit("/home")
    cy.contains("a", "Request access").first().click()
    cy.location("pathname").should("eq", "/request-access")
    cy.get("h1").should("have.text", "Request access")
  })

  it("stays public for returning visitors", () => {
    cy.setCookie("has_account", "1")

    cy.visit("/request-access")

    cy.location("pathname").should("eq", "/request-access")
    cy.get("h1").should("have.text", "Request access")
  })

  it("stays public for authenticated visitors", () => {
    cy.registerAndLogin({ name: "Request Access User" })

    cy.visit("/request-access")

    cy.location("pathname").should("eq", "/request-access")
    cy.get("h1").should("have.text", "Request access")
  })

  it("keeps nested request-access paths behind the normal auth gate", () => {
    cy.visit("/request-access/anything")

    cy.location("pathname").should("eq", "/register")
  })
})
