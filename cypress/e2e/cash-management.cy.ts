describe("Cash Management", () => {
  beforeEach(() => {
    cy.login() // use existing auth helper
  })

  describe("Payment with deposit location", () => {
    it("shows deposit location dropdown on record payment form", () => {
      // Navigate to an active loan's payment form
      cy.visit("/loans")
      cy.get("table tbody tr").first().click()
      cy.contains("Record Payment").click()

      // Verify deposit location dropdown exists with correct options
      cy.get("#depositLocation").should("exist")
      cy.get("#depositLocation").click()
      cy.contains("Cash").should("be.visible")
      cy.contains("Bank").should("be.visible")
      cy.contains("Strong Room").should("be.visible")
    })

    it("defaults deposit location to Cash", () => {
      cy.visit("/loans")
      cy.get("table tbody tr").first().click()
      cy.contains("Record Payment").click()

      cy.get("#depositLocation").should("contain.text", "Cash")
    })
  })

  describe("Loan creation with disbursement source", () => {
    it("shows disbursement source dropdown in Step 1", () => {
      cy.visit("/loans/new?customerId=test-customer-id")

      cy.get("#disbursementSource").should("exist")
      cy.get("#disbursementSource").click()
      cy.contains("Cash").should("be.visible")
      cy.contains("Bank").should("be.visible")
      cy.contains("Strong Room").should("be.visible")
    })

    it("includes disbursement source in review step", () => {
      // Fill Step 1 fields and proceed to step 3
      // Verify disbursement source appears in review
      cy.visit("/loans/new?customerId=test-customer-id")
      cy.get("#principalAmount").type("1000000")
      cy.get("#disbursementSource").click()
      cy.contains("Bank").click()
      cy.contains("button", "Next").click()

      // Step 2: collateral
      cy.get("#collateralNature").type("Land Title")
      cy.contains("button", "Next").click()

      // Step 3: review
      cy.contains("Disbursement Source").should("be.visible")
      cy.contains("Bank").should("be.visible")
    })
  })

  describe("Fund transfers page", () => {
    it("renders fund transfers page from sidebar", () => {
      cy.visit("/fund-transfers")
      cy.contains("Fund Transfers").should("be.visible")
    })

    it("opens new transfer dialog", () => {
      cy.visit("/fund-transfers")
      cy.contains("button", "New Transfer").click()
      cy.contains("Record Fund Transfer").should("be.visible")
      cy.get("#fromLocation").should("exist")
      cy.get("#toLocation").should("exist")
      cy.get("#transferAmount").should("exist")
    })

    it("validates from and to must differ", () => {
      cy.visit("/fund-transfers")
      cy.contains("button", "New Transfer").click()

      // Set both to cash
      cy.get("#fromLocation").click()
      cy.get("[role=option]").contains("Cash").click()
      cy.get("#toLocation").click()
      cy.get("[role=option]").contains("Cash").click()

      cy.get("#transferAmount").type("100000")
      cy.contains("button", "Record Transfer").click()

      cy.contains("Source and destination must be different").should("be.visible")
    })

    it("sidebar has Fund Transfers link under Capital", () => {
      cy.visit("/dashboard")
      cy.get("[data-testid=sidebar-nav]").contains("Fund Transfers").should("be.visible")
    })
  })

  describe("Balance sheet per-location breakdown", () => {
    it("shows per-location asset rows", () => {
      cy.visit("/reports/balance-sheet")
      cy.contains("Cash on Hand").should("be.visible")
      cy.contains("Bank").should("be.visible")
      cy.contains("Strong Room").should("be.visible")
      cy.contains("Loans Outstanding").should("be.visible")
      cy.contains("Total Assets").should("be.visible")
    })
  })
})
