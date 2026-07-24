/**
 * E2E tests for the /fund-transfers page.
 * Covers page rendering, access control, empty state,
 * new transfer dialog, capital injection dialog,
 * transfer history table, and mobile responsiveness.
 */

describe("Fund Transfers (/fund-transfers)", () => {
  function seedCashBalance(amount = "2000000") {
    cy.contains("button", "Capital Injection").click()
    cy.contains("Record Capital Injection", { timeout: 5000 }).should("be.visible")
    cy.get("#injectionAmount").type(amount)
    cy.contains("button", "Review").click()
    cy.contains("button", "Inject capital", { timeout: 5000 }).click()
    cy.contains("Capital injection recorded", { timeout: 10000 }).should("be.visible")
  }

  describe("Access control", () => {
    it("shows access denied for loanOfficer role", () => {
      cy.task("db:reset")
      const email = `officer-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("Loan Officer")
      cy.get("#email").type(email)
      cy.get("#password").type("TestPass123!")
      cy.get("#confirmPassword").type("TestPass123!")
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("satisfy", (url: string) =>
        url.includes("/dashboard") ||
        url.includes("/pending-approval") ||
        url.includes("/verify-email")
      )

      cy.task("db:promoteUser", { email, role: "loanOfficer" })
      cy.clearCookies()
      cy.visit("/login")
      cy.get("#email").type(email)
      cy.get("#password").type("TestPass123!")
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/fund-transfers")
      cy.contains("Access denied", { timeout: 15000 }).should("be.visible")
      cy.contains("You need Admin or higher permissions to view fund transfers").should(
        "be.visible"
      )
    })

    it("shows access denied for supervisor role", () => {
      cy.task("db:reset")
      const email = `supervisor-${Date.now()}@fidexa.org`
      cy.visit("/register")
      cy.get("#name").type("Supervisor User")
      cy.get("#email").type(email)
      cy.get("#password").type("TestPass123!")
      cy.get("#confirmPassword").type("TestPass123!")
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("satisfy", (url: string) =>
        url.includes("/dashboard") ||
        url.includes("/pending-approval") ||
        url.includes("/verify-email")
      )

      cy.task("db:promoteUser", { email, role: "supervisor" })
      cy.clearCookies()
      cy.visit("/login")
      cy.get("#email").type(email)
      cy.get("#password").type("TestPass123!")
      cy.get("button[type=submit]").click()
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      cy.visit("/fund-transfers")
      cy.contains("Access denied", { timeout: 15000 }).should("be.visible")
    })
  })

  describe("Page rendering (admin)", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Fund Transfer Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("renders page heading and subtitle", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("Move money between cash, bank, and strong room").should("be.visible")
    })

    it("shows New Transfer button", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").should("be.visible")
    })

    it("shows Capital Injection button", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").should("be.visible")
    })

    it("shows empty state when no transfers exist", () => {
      cy.visit("/fund-transfers")
      cy.contains("No fund transfers recorded yet", { timeout: 15000 }).should("be.visible")
    })
  })

  describe("New Transfer dialog", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Transfer Dialog Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("opens the Record Fund Transfer dialog", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")
    })

    it("shows From, To, Transfer Date, Amount, and Note fields", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")

      cy.contains("label", "From").should("be.visible")
      cy.contains("label", "To").should("be.visible")
      cy.contains("label", "Transfer Date").should("be.visible")
      cy.contains("label", "Amount (UGX)").should("be.visible")
      cy.contains("label", "Note (optional)").should("be.visible")
    })

    it("shows Review submit button", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")
      cy.contains("button", "Review").should("be.visible")
    })

    it("requires backdate reason when transfer date is in the past", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")

      cy.get("#transferDate").type("{selectall}{backspace}")
      cy.get("#transferDate").type("2026-01-01")
      cy.get("#transferAmount").type("250000")
      cy.contains("button", "Review").click()
      cy.contains("A reason is required when backdating", { timeout: 5000 }).should("be.visible")
    })

    it("creates a fund transfer successfully and shows success toast", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      seedCashBalance()
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")

      // From defaults to Cash, set To to Bank (already default)
      // Type amount
      cy.get("#transferAmount").type("500000")
      cy.get("#transferNote").type("Deposit to bank")
      cy.contains("button", "Review").click()
      cy.contains("button", "Transfer funds", { timeout: 5000 }).click()

      cy.contains("Fund transfer recorded", { timeout: 10000 }).should("be.visible")
    })

    it("shows transfer in the table after creation", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      seedCashBalance()
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")

      cy.get("#transferAmount").type("750000")
      cy.get("#transferNote").type("Weekly bank deposit")
      cy.contains("button", "Review").click()
      cy.contains("button", "Transfer funds", { timeout: 5000 }).click()
      cy.contains("Fund transfer recorded", { timeout: 10000 }).should("be.visible")

      // Table should now show the transfer
      cy.contains("750,000", { timeout: 10000 }).should("be.visible")
      cy.contains("Weekly bank deposit").should("be.visible")
      cy.contains("Transfer").should("be.visible")
    })
  })

  describe("Capital Injection dialog", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Injection Dialog Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("opens the Record Capital Injection dialog", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").click()
      cy.contains("Record Capital Injection", { timeout: 5000 }).should("be.visible")
    })

    it("shows Deposit To, Transfer Date, Amount, and Note fields", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").click()
      cy.contains("Record Capital Injection", { timeout: 5000 }).should("be.visible")

      cy.contains("label", "Deposit To").should("be.visible")
      cy.contains("label", "Transfer Date").should("be.visible")
      cy.contains("label", "Amount (UGX)").should("be.visible")
      cy.contains("label", "Note (optional)").should("be.visible")
    })

    it("shows description about bringing money into the business", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").click()
      cy.contains("Bring money into the business from shareholders or owners", {
        timeout: 5000,
      }).should("be.visible")
    })

    it("shows Review submit button", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").click()
      cy.contains("Record Capital Injection", { timeout: 5000 }).should("be.visible")
      cy.contains("button", "Review").should("be.visible")
    })

    it("creates a capital injection successfully and shows success toast", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").click()
      cy.contains("Record Capital Injection", { timeout: 5000 }).should("be.visible")

      cy.get("#injectionAmount").type("2000000")
      cy.get("#injectionNote").type("Shareholder contribution Q1")
      cy.contains("button", "Review").click()
      cy.contains("button", "Inject capital", { timeout: 5000 }).click()

      cy.contains("Capital injection recorded", { timeout: 10000 }).should("be.visible")
    })

    it("shows capital injection in table with Capital In badge", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").click()
      cy.contains("Record Capital Injection", { timeout: 5000 }).should("be.visible")

      cy.get("#injectionAmount").type("1500000")
      cy.get("#injectionNote").type("Owner capital")
      cy.contains("button", "Review").click()
      cy.contains("button", "Inject capital", { timeout: 5000 }).click()
      cy.contains("Capital injection recorded", { timeout: 10000 }).should("be.visible")

      cy.contains("1,500,000", { timeout: 10000 }).should("be.visible")
      cy.contains("Capital In").should("be.visible")
      cy.contains("Owner capital").should("be.visible")
    })
  })

  describe("Transfer history table", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Table Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Create a transfer so the table has data
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      seedCashBalance()
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")
      cy.get("#transferAmount").type("1000000")
      cy.get("#transferNote").type("Initial transfer")
      cy.contains("button", "Review").click()
      cy.contains("button", "Transfer funds", { timeout: 5000 }).click()
      cy.contains("Fund transfer recorded", { timeout: 10000 }).should("be.visible")
    })

    it("shows correct table headers", () => {
      cy.visit("/fund-transfers")
      cy.contains("1,000,000", { timeout: 15000 }).should("be.visible")

      cy.contains("th", "Date").should("exist")
      cy.contains("th", "Type").should("exist")
      cy.contains("th", "From").should("exist")
      cy.contains("th", "To").should("exist")
      cy.contains("th", "Amount").should("exist")
      cy.contains("th", "Note").should("exist")
    })

    it("displays formatted currency in amount column", () => {
      cy.visit("/fund-transfers")
      cy.contains("1,000,000", { timeout: 15000 }).should("be.visible")
      cy.contains("UGX").should("be.visible")
    })

    it("shows Transfer badge for regular transfers", () => {
      cy.visit("/fund-transfers")
      cy.contains("1,000,000", { timeout: 15000 }).should("be.visible")
      cy.contains("Transfer").should("be.visible")
    })

    it("shows note text in the note column", () => {
      cy.visit("/fund-transfers")
      cy.contains("Initial transfer", { timeout: 15000 }).should("be.visible")
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Mobile Fund Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("renders fund transfers page at mobile", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
    })

    it("shows tab bar at mobile", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.get("[data-testid='bottom-tab-bar']").should("exist")
        .should("have.css", "display", "flex")
      cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
    })

    it("New Transfer and Capital Injection buttons are visible at mobile", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").should("be.visible")
      cy.contains("button", "Capital Injection").should("be.visible")
    })
  })
})
