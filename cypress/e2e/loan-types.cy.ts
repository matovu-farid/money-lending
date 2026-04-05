describe("Loan Type Abstraction", () => {
  let customerId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Loan Officer" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer to issue loans to
    cy.visit("/customers/new")
    cy.get("#fullName").type("Type Test Borrower")
    cy.get("#contact").type("0771000001")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]
    })
  })

  describe("Loan Creation Form", () => {
    it("defaults to Perpetual loan type", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.contains("Loan Details")

      // Perpetual radio should be checked by default
      cy.get("input[name='loanType'][value='perpetual']").should("be.checked")
      cy.get("input[name='loanType'][value='fixed_rate']").should("not.be.checked")
      cy.get("input[name='loanType'][value='reducing_balance']").should("not.be.checked")

      // Term months field should NOT be visible
      cy.get("#termMonths").should("not.exist")
    })

    it("shows term months field when Fixed Rate is selected", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      cy.get("input[name='loanType'][value='fixed_rate']").check()
      cy.get("input[name='loanType'][value='fixed_rate']").should("be.checked")

      // Term months input should appear
      cy.get("#termMonths").should("be.visible")
      cy.contains("Term (months)").should("be.visible")
    })

    it("shows term months field when Reducing Balance is selected", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      cy.get("input[name='loanType'][value='reducing_balance']").check()
      cy.get("input[name='loanType'][value='reducing_balance']").should("be.checked")

      cy.get("#termMonths").should("be.visible")
      cy.contains("Term (months)").should("be.visible")
    })

    it("hides term months when switching back to Perpetual", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      // Select fixed_rate — term months should appear
      cy.get("input[name='loanType'][value='fixed_rate']").check()
      cy.get("#termMonths").should("be.visible")

      // Switch back to perpetual — term months should disappear
      cy.get("input[name='loanType'][value='perpetual']").check()
      cy.get("#termMonths").should("not.exist")
    })

    it("shows all three loan type radio buttons with correct labels", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      cy.contains("Loan Type").should("be.visible")
      cy.contains("Perpetual").should("be.visible")
      cy.contains("Fixed Rate").should("be.visible")
      cy.contains("Reducing Balance").should("be.visible")
    })

    it("validates term months is required for non-perpetual types", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      // Select fixed_rate but leave term months empty
      cy.get("input[name='loanType'][value='fixed_rate']").check()
      cy.get("#principalAmount").type("1000000")
      cy.get("#issuanceFee").type("50000")
      cy.get("#description").type("Test loan for term validation")
      cy.contains("button", "Next").click()

      // Should show term months validation error
      cy.contains("Term months is required").should("be.visible")
    })

    it("shows loan type in Step 3 review", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      // Select fixed rate with term
      cy.get("input[name='loanType'][value='fixed_rate']").check()
      cy.get("#termMonths").type("6")
      cy.get("#principalAmount").type("1000000")
      cy.get("#issuanceFee").type("50000")
      cy.get("#description").type("Fixed rate test loan")
      cy.contains("button", "Next").click()

      // Step 2
      cy.get("#collateralNature").type("Land Title")
      cy.contains("button", "Next").click()

      // Step 3 review should show loan type and term
      cy.contains("Loan Type")
      cy.contains("Fixed Rate")
      cy.contains("Term")
      cy.contains("6 months")
    })

    it("shows amortization schedule for fixed rate loan in Step 3", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      cy.get("input[name='loanType'][value='fixed_rate']").check()
      cy.get("#termMonths").type("3")
      cy.get("#principalAmount").type("1000000")
      cy.get("#issuanceFee").type("50000")
      cy.get("#description").type("Fixed rate loan with schedule")
      cy.contains("button", "Next").click()

      // Step 2
      cy.get("#collateralNature").type("Vehicle Log Book")
      cy.contains("button", "Next").click()

      // Step 3 — should show amortization table
      cy.contains("Interest Calculation Preview")
      cy.contains("Total Interest")
      cy.contains("Total Owed")
      cy.contains("Monthly Installment")
      // Table headers
      cy.contains("th", "Month")
      cy.contains("th", "Principal")
      cy.contains("th", "Interest")
      cy.contains("th", "Installment")
      cy.contains("th", "Balance")
    })

    it("shows perpetual interest preview (not schedule) for perpetual loan in Step 3", () => {
      cy.visit(`/loans/new?customerId=${customerId}`)

      // Keep default perpetual type
      cy.get("#principalAmount").type("1000000")
      cy.get("#issuanceFee").type("50000")
      cy.get("#description").type("Perpetual loan preview test")
      cy.contains("button", "Next").click()

      // Step 2
      cy.get("#collateralNature").type("Land Title")
      cy.contains("button", "Next").click()

      // Step 3 — perpetual shows daily interest, not amortization table
      cy.contains("Interest Calculation Preview")
      cy.contains("Daily interest amount")
      cy.contains("Total interest at minimum period")
      cy.contains("Total owed at minimum period")
      cy.contains("Minimum interest period applies even if repaid early")
    })
  })

  describe("Loan List", () => {
    it("shows loan type column in the table", () => {
      cy.viewport(1280, 900)
      cy.visit("/loans")
      // Even with no data, check for the column header existence
      // (may be in empty state — create a loan first)
      // Create a loan to ensure the table renders
      cy.visit("/customers/new")
      cy.get("#fullName").type("List Test Borrower")
      cy.get("#contact").type("0771000002")
      cy.get("#address").type("Kampala, Uganda")
      cy.contains("button", "Register Customer").click()
      cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

      cy.url().then((url) => {
        const cid = url.split("/customers/")[1]
        cy.visit(`/loans/new?customerId=${cid}`)
        cy.get("#principalAmount").type("500000")
        cy.get("#issuanceFee").type("50000")
        cy.get("#description").type("Test loan for list")
        cy.contains("button", "Next").click()
        cy.get("#collateralNature").type("Land Title")
        cy.contains("button", "Next").click()
        cy.contains("button", "Issue Loan").click()
        cy.dismissReceiptModal()

        cy.visit("/loans")
        cy.contains("Type", { timeout: 10000 }).should("exist")
        // The loan should show "Perpetual" as the default type
        cy.contains("Perpetual").should("exist")
      })
    })
  })
})
