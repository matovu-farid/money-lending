/**
 * E2E tests for bank account management on the /fund-transfers page.
 * Covers:
 * 1. Bank accounts section is visible on the fund transfers page
 * 2. Creating a new bank account
 * 3. Inline bank account dropdown in transfer dialog when "Bank" is selected
 * 4. Inline bank account dropdown in capital injection dialog when "Bank" is selected
 * 5. Admin can deactivate and reactivate a bank account
 */

describe("Bank Account Management (/fund-transfers)", () => {
  describe("Bank accounts section visibility", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Bank Account Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("shows Bank Accounts card section on the fund transfers page", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("Bank Accounts").should("be.visible")
    })

    it("shows New Account button for admin users", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").should("be.visible")
    })

    it("shows empty state when no bank accounts exist", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("No bank accounts configured yet").should("be.visible")
    })
  })

  describe("Creating a new bank account", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Bank Account Creator" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })

    it("opens the Create Bank Account dialog", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").click()
      cy.contains("Create Bank Account", { timeout: 5000 }).should("be.visible")
    })

    it("shows Account Name field in the dialog", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").click()
      cy.contains("Create Bank Account", { timeout: 5000 }).should("be.visible")
      cy.get("#bankAccountName").should("exist")
      cy.contains("label", "Account Name").should("be.visible")
    })

    it("shows validation error when submitting without a name", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").click()
      cy.contains("Create Bank Account", { timeout: 5000 }).should("be.visible")
      cy.contains("button", "Create Account").click()
      cy.contains("Account name is required").should("be.visible")
    })

    it("creates a bank account successfully and shows success toast", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").click()
      cy.contains("Create Bank Account", { timeout: 5000 }).should("be.visible")

      cy.get("#bankAccountName").type("Stanbic Business Account")
      cy.contains("button", "Create Account").click()

      cy.contains("Bank account created", { timeout: 10000 }).should("be.visible")
    })

    it("shows the new bank account in the table after creation", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").click()
      cy.contains("Create Bank Account", { timeout: 5000 }).should("be.visible")

      cy.get("#bankAccountName").type("Centenary Bank Main")
      cy.contains("button", "Create Account").click()
      cy.contains("Bank account created", { timeout: 10000 }).should("be.visible")

      cy.contains("Centenary Bank Main", { timeout: 10000 }).should("be.visible")
      cy.contains("Active").should("be.visible")
    })

    it("shows correct table headers after an account is created", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").click()
      cy.get("#bankAccountName").type("Equity Bank")
      cy.contains("button", "Create Account").click()
      cy.contains("Bank account created", { timeout: 10000 }).should("be.visible")

      cy.contains("th", "Name").should("exist")
      cy.contains("th", "Balance").should("exist")
      cy.contains("th", "Status").should("exist")
    })
  })

  describe("Bank account dropdown in transfer dialog", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Transfer Bank Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Create a bank account first so the dropdown has options
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").click()
      cy.get("#bankAccountName").type("Test Transfer Bank")
      cy.contains("button", "Create Account").click()
      cy.contains("Bank account created", { timeout: 10000 }).should("be.visible")
    })

    it("shows bank account dropdown when From is set to Bank", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")

      cy.get("#fromLocation").click()
      cy.get("[role=option]").contains("Bank").click()

      // Inline bank account select should appear
      cy.contains("label", "From Bank Account").should("be.visible")
      cy.contains("Select bank account").should("be.visible")
    })

    it("shows bank account dropdown when To is set to Bank", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")

      // toLocation defaults to bank — verify the dropdown appears
      cy.contains("label", "To Bank Account").should("be.visible")
      cy.contains("Select bank account").should("be.visible")
    })

    it("hides bank account dropdown when From is not Bank", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")

      // fromLocation defaults to cash — no bank account dropdown for From
      cy.contains("label", "From Bank Account").should("not.exist")
    })

    it("lists the created bank account in the dropdown", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")

      // toLocation defaults to bank, open its bank account select
      cy.get("#toLocation").click()
      cy.get("[role=option]").contains("Bank").click()

      // Open the bank account dropdown and verify the account is listed
      cy.contains("label", "To Bank Account").parent().find("[data-slot=select-trigger]").click()
      cy.contains("Test Transfer Bank").should("be.visible")
    })
  })

  describe("Bank account dropdown in capital injection dialog", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Injection Bank Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Create a bank account
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").click()
      cy.get("#bankAccountName").type("Injection Test Bank")
      cy.contains("button", "Create Account").click()
      cy.contains("Bank account created", { timeout: 10000 }).should("be.visible")
    })

    it("shows bank account dropdown when Deposit To is set to Bank", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").click()
      cy.contains("Record Capital Injection", { timeout: 5000 }).should("be.visible")

      cy.get("#injectionToLocation").click()
      cy.get("[role=option]").contains("Bank").click()

      // Inline bank account select should appear
      cy.contains("label", "Bank Account").should("be.visible")
      cy.contains("Select bank account").should("be.visible")
    })

    it("hides bank account dropdown when Deposit To is not Bank", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").click()
      cy.contains("Record Capital Injection", { timeout: 5000 }).should("be.visible")

      // Default toLocation is cash — bank account dropdown should not appear
      cy.contains("label", "Bank Account").should("not.exist")
    })

    it("lists the created bank account in the injection dropdown when Bank is selected", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Capital Injection").click()
      cy.contains("Record Capital Injection", { timeout: 5000 }).should("be.visible")

      cy.get("#injectionToLocation").click()
      cy.get("[role=option]").contains("Bank").click()

      // Open the bank account dropdown and verify the account appears
      cy.contains("label", "Bank Account").parent().find("[data-slot=select-trigger]").click()
      cy.contains("Injection Test Bank").should("be.visible")
    })
  })

  describe("Deactivate and reactivate a bank account", () => {
    beforeEach(() => {
      cy.task("db:reset")
      cy.registerAndLogin({ name: "Status Toggle Admin" })
      cy.url({ timeout: 15000 }).should("include", "/dashboard")

      // Create a bank account to act on
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "New Account").click()
      cy.get("#bankAccountName").type("Toggle Status Bank")
      cy.contains("button", "Create Account").click()
      cy.contains("Bank account created", { timeout: 10000 }).should("be.visible")
      cy.contains("Toggle Status Bank", { timeout: 10000 }).should("be.visible")
    })

    it("shows Active badge for a newly created bank account", () => {
      cy.visit("/fund-transfers")
      cy.contains("Toggle Status Bank", { timeout: 15000 }).should("be.visible")
      cy.contains("tr", "Toggle Status Bank").within(() => {
        cy.contains("Active").should("be.visible")
      })
    })

    it("admin can deactivate a bank account and sees Inactive badge", () => {
      cy.visit("/fund-transfers")
      cy.contains("Toggle Status Bank", { timeout: 15000 }).should("be.visible")

      // Open the row actions dropdown
      cy.contains("tr", "Toggle Status Bank").within(() => {
        cy.get("[aria-label='Account actions']").click()
      })

      cy.contains("Deactivate").click()
      cy.contains("Account deactivated", { timeout: 10000 }).should("be.visible")

      // Badge should change to Inactive
      cy.contains("tr", "Toggle Status Bank").within(() => {
        cy.contains("Inactive").should("be.visible")
        cy.contains("Active").should("not.exist")
      })
    })

    it("admin can reactivate a deactivated bank account and sees Active badge", () => {
      cy.visit("/fund-transfers")
      cy.contains("Toggle Status Bank", { timeout: 15000 }).should("be.visible")

      // Deactivate first
      cy.contains("tr", "Toggle Status Bank").within(() => {
        cy.get("[aria-label='Account actions']").click()
      })
      cy.contains("Deactivate").click()
      cy.contains("Account deactivated", { timeout: 10000 }).should("be.visible")

      // Now reactivate
      cy.contains("tr", "Toggle Status Bank").within(() => {
        cy.get("[aria-label='Account actions']").click()
      })
      cy.contains("Reactivate").click()
      cy.contains("Account reactivated", { timeout: 10000 }).should("be.visible")

      // Badge should be Active again
      cy.contains("tr", "Toggle Status Bank").within(() => {
        cy.contains("Active").should("be.visible")
        cy.contains("Inactive").should("not.exist")
      })
    })

    it("deactivated bank account does not appear in the bank account select dropdown", () => {
      cy.visit("/fund-transfers")
      cy.contains("Toggle Status Bank", { timeout: 15000 }).should("be.visible")

      // Deactivate the account
      cy.contains("tr", "Toggle Status Bank").within(() => {
        cy.get("[aria-label='Account actions']").click()
      })
      cy.contains("Deactivate").click()
      cy.contains("Account deactivated", { timeout: 10000 }).should("be.visible")

      // Open the transfer dialog and check bank account dropdown
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer", { timeout: 5000 }).should("be.visible")

      // toLocation defaults to bank — the deactivated account should not show
      // The component falls back to "No bank accounts configured" message when no active accounts
      cy.contains("No bank accounts configured").should("be.visible")
    })
  })
})
