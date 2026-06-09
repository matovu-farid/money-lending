describe("Creditors", () => {
  beforeEach(() => {
    cy.clearCookies()
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Admin User" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")
  })

  it("shows the creditors list page with system capital KPIs", () => {
    cy.visit("/creditors")
    cy.contains("Creditors").should("be.visible")
    cy.contains("Total Invested").should("be.visible")
  })

  it("shows empty state when no creditors exist", () => {
    cy.visit("/creditors")
    cy.contains("No creditors yet").should("be.visible")
    cy.contains("Register your first creditor to start tracking invested capital.").should("be.visible")
  })

  it("can navigate to the add creditor form", () => {
    cy.visit("/creditors")
    cy.contains("Add Creditor").click()
    cy.url().should("include", "/creditors/new")
  })

  it("can register a new creditor with initial investment", () => {
    cy.visit("/creditors/new")
    cy.get('input[name="name"]').type("Test Creditor")
    cy.get('input[name="contact"]').type("0700000000")
    cy.get('input[name="address"]').type("Kampala, Uganda")
    cy.get('input[name="amount"]').type("5000000")
    cy.get('input[name="interestRateMonthly"]').clear().type("10")
    cy.contains("button", "Add Creditor").click()
    // Wait for the button to show "Saving..." indicating the form submitted
    cy.contains("button", "Saving...").should("exist")
    // Then wait for the redirect to the creditors list
    cy.url({ timeout: 30000 }).should("match", /\/creditors$/)
    cy.contains("Test Creditor", { timeout: 10000 }).should("be.visible")
  })

  it("shows validation errors for empty required fields", () => {
    cy.visit("/creditors/new")
    cy.contains("button", "Add Creditor").click()
    cy.contains("Name is required").should("be.visible")
    cy.contains("Contact is required").should("be.visible")
    cy.contains("Address is required").should("be.visible")
  })

  it("repayments reduce the outstanding balance (regression)", () => {
    // Regression for: creditor repayments not decreasing the borrowed amount.
    // Root cause was in getCreditorBalancesFromLedger — repayment ledger legs
    // use referenceId=repaymentId and were filtered out by referenceId IN (investmentIds).
    cy.visit("/creditors/new")
    cy.get('input[name="name"]').type("Repayment Test Creditor")
    cy.get('input[name="contact"]').type("0733333333")
    cy.get('input[name="address"]').type("Kampala, Uganda")
    cy.get('input[name="amount"]').type("5000000")
    cy.get('input[name="interestRateMonthly"]').clear().type("0")
    cy.contains("button", "Add Creditor").click()
    cy.url({ timeout: 30000 }).should("match", /\/creditors$/)

    cy.contains("Repayment Test Creditor", { timeout: 10000 }).should("be.visible")
    cy.contains("View").first().click()
    cy.url({ timeout: 5000 }).should("match", /\/creditors\/.+/)

    // Outstanding starts at the full invested amount.
    cy.get('[data-testid="kpi-card"][data-kpi-label="Outstanding Balance"]', { timeout: 10000 })
      .find('[data-testid="kpi-value"]')
      .invoke("text")
      .then((before) => {
        const beforeAmount = Number(before.replace(/[^\d.-]/g, ""))
        expect(beforeAmount).to.be.at.least(5_000_000)

        // Per-row Repay button — first (and only) investment row.
        cy.get('[data-testid="data-row"]').first().contains("button", "Repay").click()
        cy.get('input[name="amount"]').type("1000000")
        cy.contains("button", "Review").click()
        cy.contains("button", "Record repayment").click()
        cy.contains("Repayment recorded successfully", { timeout: 10000 }).should("be.visible")

        cy.get('[data-testid="kpi-card"][data-kpi-label="Outstanding Balance"]')
          .find('[data-testid="kpi-value"]')
          .invoke("text")
          .should((after) => {
            const afterAmount = Number(after.replace(/[^\d.-]/g, ""))
            // Balance must decrease by the repayment amount.
            expect(afterAmount).to.equal(beforeAmount - 1_000_000)
          })

        // Repayments tab shows the new repayment row.
        cy.contains("Repayments").click()
        cy.get('[data-testid="data-row"]').should("have.length.gte", 1)
      })
  })

  it("shows receipt buttons on investment and repayment rows", () => {
    cy.visit("/creditors/new")
    cy.get('input[name="name"]').type("Receipt Test Creditor")
    cy.get('input[name="contact"]').type("0744444444")
    cy.get('input[name="address"]').type("Kampala, Uganda")
    cy.get('input[name="amount"]').type("3000000")
    cy.get('input[name="interestRateMonthly"]').clear().type("0")
    cy.contains("button", "Add Creditor").click()
    cy.url({ timeout: 30000 }).should("match", /\/creditors$/)

    cy.contains("View").first().click()
    cy.url({ timeout: 5000 }).should("match", /\/creditors\/.+/)

    // Investments tab — receipt button per investment row.
    cy.get('button[aria-label="POS receipt"]', { timeout: 10000 }).should("have.length.gte", 1)
    cy.get('button[aria-label="POS receipt"]').first().click()
    cy.contains("Creditor Investment Received", { timeout: 10000 }).should("be.visible")
    cy.contains("Received from").should("be.visible")
    cy.contains("Receipt Test Creditor").should("be.visible")
    cy.contains("button", "Close").click()

    // Record a repayment so the Repayments tab has data.
    cy.get('[data-testid="data-row"]').first().contains("button", "Repay").click()
    cy.get('input[name="amount"]').type("500000")
    cy.contains("button", "Review").click()
    cy.contains("button", "Record repayment").click()
    cy.contains("Repayment recorded successfully", { timeout: 10000 }).should("be.visible")

    cy.contains("Repayments").click()
    cy.get('[data-testid="data-row"]').should("have.length.gte", 1)
    cy.get('[data-testid="data-row"]').first().find('button[aria-label="POS receipt"]').click()
    cy.contains("Creditor Repayment", { timeout: 10000 }).should("be.visible")
    cy.contains("Paid to").should("be.visible")
  })

  it("can view creditor profile with KPI dashboard", () => {
    // Register a creditor first
    cy.visit("/creditors/new")
    cy.get('input[name="name"]').type("Dashboard Creditor")
    cy.get('input[name="contact"]').type("0711111111")
    cy.get('input[name="address"]').type("Entebbe, Uganda")
    cy.get('input[name="amount"]').type("10000000")
    cy.get('input[name="interestRateMonthly"]').clear().type("5")
    cy.contains("button", "Add Creditor").click()
    cy.contains("button", "Saving...").should("exist")
    cy.url({ timeout: 30000 }).should("match", /\/creditors$/)

    // View the creditor profile
    cy.contains("View", { timeout: 10000 }).first().click()
    cy.url({ timeout: 5000 }).should("match", /\/creditors\/.+/)

    // KPI cards should be visible
    cy.contains("Total Invested").should("be.visible")
    cy.contains("Outstanding Balance").should("be.visible")

    // Tabs should be visible
    cy.contains("Investments").should("be.visible")
    cy.contains("Repayments").should("be.visible")
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders page at mobile and shows tab bar", () => {
      cy.visit("/creditors")
      cy.get("h1").should("be.visible")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })

    it("shows card layout instead of table at mobile", () => {
      // Seed a creditor inline so we have data to display
      cy.visit("/creditors/new")
      cy.get('input[name="name"]').type("Mobile Creditor Test")
      cy.get('input[name="contact"]').type("0722222222")
      cy.get('input[name="address"]').type("Kampala, Uganda")
      cy.get('input[name="amount"]').type("2000000")
      cy.contains("button", "Add Creditor").click()
      cy.url({ timeout: 30000 }).should("match", /\/creditors$/)
      cy.visit("/creditors")
      cy.get("[data-slot='table-container']").should("not.be.visible")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
    })
  })
})
