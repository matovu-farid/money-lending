describe("Mobile Navigation", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Nav Test User" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    // NAV-01: Bottom tab bar with 5 primary tabs
    it("shows bottom tab bar with 5 tabs", () => {
      // The tab bar is position:fixed at the bottom — use exist + CSS check
      // to avoid false failures from Next.js dev mode overlay (data-next-badge-root)
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='bottom-tab-dashboard']").should("exist")
      cy.get("[data-testid='bottom-tab-customers']").should("exist")
      cy.get("[data-testid='bottom-tab-payments']").should("exist")
      cy.get("[data-testid='bottom-tab-loans']").should("exist")
      cy.get("[data-testid='bottom-tab-more']").should("exist")
    })

    // NAV-03: Sidebar hidden on mobile
    it("does NOT show sidebar", () => {
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })

    // NAV-04: Active tab highlighted for current route
    it("highlights active tab for current route", () => {
      // On /dashboard, Dashboard tab should have active styling (text-primary)
      cy.get("[data-testid='bottom-tab-dashboard']")
        .should("have.class", "text-primary")

      // Navigate to /customers
      cy.get("[data-testid='bottom-tab-customers']").click()
      cy.url().should("include", "/customers")
      cy.get("[data-testid='bottom-tab-customers']")
        .should("have.class", "text-primary")
      // Dashboard tab should no longer be active
      cy.get("[data-testid='bottom-tab-dashboard']")
        .should("have.class", "text-muted-foreground")
    })

    // NAV-02: More tap opens bottom sheet with 5 secondary items
    it("tapping More opens bottom sheet with all secondary items", () => {
      cy.get("[data-testid='bottom-tab-more']").click()
      cy.get("[data-testid='more-sheet']").should("be.visible")
      cy.get("[data-testid='more-item-creditors']").should("be.visible")
      cy.get("[data-testid='more-item-expenses']").should("be.visible")
      cy.get("[data-testid='more-item-income']").should("be.visible")
      cy.get("[data-testid='more-item-reports']").should("be.visible")
      cy.get("[data-testid='more-item-watchlist']").should("be.visible")
    })

    // NAV-02: Navigating from More sheet closes it
    it("navigating via More sheet item closes the sheet", () => {
      cy.get("[data-testid='bottom-tab-more']").click()
      cy.get("[data-testid='more-sheet']").should("be.visible")
      cy.get("[data-testid='more-item-creditors']").click()
      cy.url().should("include", "/creditors")
      cy.get("[data-testid='more-sheet']").should("not.exist")
    })

    // NAV-05: Safe-area-inset padding is applied via CSS custom property
    it("tab bar has safe-area-inset padding class", () => {
      // The safe-area-bottom class applies padding-bottom: var(--safe-bottom)
      // which resolves to env(safe-area-inset-bottom, 0px)
      cy.get("[data-testid='bottom-tab-bar']")
        .should("have.class", "safe-area-bottom")
    })

    // NAV-03: Hamburger button removed
    it("does NOT show hamburger menu button", () => {
      cy.get("button[aria-label='Open navigation menu']").should("not.exist")
    })

    // NAV-04: Active indicator line on current tab
    it("shows active indicator line on current tab", () => {
      // Dashboard is active — its indicator should be visible (opacity-100)
      cy.get("[data-testid='bottom-tab-dashboard']")
        .find("span.bg-primary")
        .should("have.class", "opacity-100")
    })
  })

  context("at tablet/desktop viewport (1280x800)", () => {
    beforeEach(() => {
      cy.viewport(1280, 800)
    })

    // NAV-03: Sidebar visible on desktop
    it("shows sidebar navigation", () => {
      cy.get("[data-testid='sidebar-nav']").should("be.visible")
    })

    // NAV-03: Bottom tab bar absent on desktop
    it("does NOT show bottom tab bar", () => {
      cy.get("[data-testid='bottom-tab-bar']").should("not.be.visible")
    })

    // NAV-03: Hamburger removed at all viewports
    it("does NOT show hamburger menu button", () => {
      cy.get("button[aria-label='Open navigation menu']").should("not.exist")
    })
  })
})
