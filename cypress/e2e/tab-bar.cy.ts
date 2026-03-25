describe("Bottom Tab Bar", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Tab Bar Tester" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
    cy.viewport(390, 844)
  })

  it("renders 5 primary tabs", () => {
    cy.get("[data-testid='bottom-tab-bar']").should("exist")
      .should("have.css", "display", "flex")
    cy.get("[data-testid='bottom-tab-dashboard']").should("exist")
    cy.get("[data-testid='bottom-tab-customers']").should("exist")
    cy.get("[data-testid='bottom-tab-payments']").should("exist")
    cy.get("[data-testid='bottom-tab-loans']").should("exist")
    cy.get("[data-testid='bottom-tab-more']").should("exist")
  })

  it("highlights active tab for current route", () => {
    // On /dashboard, Dashboard tab should have active styling (text-primary)
    cy.get("[data-testid='bottom-tab-dashboard']")
      .should("have.class", "text-primary")

    // Navigate to /customers — use force:true to bypass dev-mode overlay elements
    cy.get("[data-testid='bottom-tab-customers']").click({ force: true })
    cy.url().should("include", "/customers")
    cy.get("[data-testid='bottom-tab-customers']")
      .should("have.class", "text-primary")
    // Dashboard tab should no longer be active
    cy.get("[data-testid='bottom-tab-dashboard']")
      .should("have.class", "text-muted-foreground")
  })

  it("switches between all primary tabs", () => {
    // Use force:true to bypass dev-mode overlay elements (data-next-badge-root, data-issues-count)
    // Wait for each URL to settle before clicking the next tab
    cy.get("[data-testid='bottom-tab-customers']").click({ force: true })
    cy.url({ timeout: 10000 }).should("include", "/customers")

    cy.get("[data-testid='bottom-tab-payments']").click({ force: true })
    cy.url({ timeout: 10000 }).should("include", "/payments")

    cy.get("[data-testid='bottom-tab-loans']").click({ force: true })
    cy.url({ timeout: 10000 }).should("include", "/loans")

    cy.get("[data-testid='bottom-tab-dashboard']").click({ force: true })
    cy.url({ timeout: 10000 }).should("include", "/dashboard")
  })

  it("More tab opens sheet with 5 secondary items", () => {
    cy.get("[data-testid='bottom-tab-more']").click()
    cy.get("[data-testid='more-sheet']").should("be.visible")
    cy.get("[data-testid='more-item-creditors']").should("be.visible")
    cy.get("[data-testid='more-item-expenses']").should("be.visible")
    cy.get("[data-testid='more-item-income']").should("be.visible")
    cy.get("[data-testid='more-item-reports']").should("be.visible")
    cy.get("[data-testid='more-item-watchlist']").should("be.visible")
  })

  it("More sheet item navigates and closes sheet", () => {
    cy.get("[data-testid='bottom-tab-more']").click()
    cy.get("[data-testid='more-sheet']").should("be.visible")
    cy.get("[data-testid='more-item-creditors']").click()
    cy.url().should("include", "/creditors")
    cy.get("[data-testid='more-sheet']").should("not.exist")
  })

  it("active indicator dot renders on current tab", () => {
    cy.get("[data-testid='bottom-tab-dashboard']")
      .find("span.bg-primary")
      .should("have.class", "opacity-100")
  })

  it("tab bar has safe-area-bottom class", () => {
    cy.get("[data-testid='bottom-tab-bar']")
      .should("have.class", "safe-area-bottom")
  })

  it("sidebar is not visible at mobile", () => {
    cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
  })
})
