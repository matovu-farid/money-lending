import type { DbLoanRow } from "../support/types"

describe("Repayment Simulator", () => {
  let customerId: string
  let loanId: string

  beforeEach(() => {
    cy.task("db:reset")
    cy.registerAndLogin({ name: "Simulator Admin" })
    cy.url({ timeout: 15000 }).should("include", "/dashboard")

    // Create a customer and issue a loan
    cy.visit("/customers/new")
    cy.get("#fullName").type("Simulator Borrower")
    cy.get("#contact").type("0771000030")
    cy.get("#address").type("Kampala, Uganda")
    cy.contains("button", "Register Customer").click()
    cy.url({ timeout: 10000 }).should("match", /\/customers\/.+/)

    cy.url().then((url) => {
      customerId = url.split("/customers/")[1]

      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.get("#principalAmount").type("1000000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").click()
      cy.get("[role=option]").contains("Land Title").click()
      cy.get("[data-base-ui-inert]").should("not.exist")
      cy.contains("button", "Next").click()
      cy.contains("button", "Issue Loan").click()
      cy.url({ timeout: 10000 }).should("include", `/customers/${customerId}`)

      // Get the loan ID from the loans list
      cy.task<DbLoanRow[]>("db:getLoans").then((loans) => {
        loanId = loans[0].id
      })
    })
  })

  it("shows simulator panel on active loan detail page", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Repayment Simulator", { timeout: 15000 }).should("be.visible")
      cy.contains("Simulate a payment to see how it would affect this loan").should("be.visible")
      cy.get("#simulatorAmount").should("be.visible")
      cy.contains("button", "Simulate").should("be.visible")
    })
  })

  it("simulates payment and shows before/after comparison", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.get("#simulatorAmount", { timeout: 15000 }).type("200000")
      cy.contains("button", "Simulate").click()

      // Should show Current and After cards
      cy.contains("Current").should("be.visible")
      cy.contains("After Simulated Payment").should("be.visible")
      cy.contains("Principal Balance").should("be.visible")
    })
  })

  it("shows fully paid message when amount covers entire balance", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      // Enter an amount larger than the total owed
      cy.get("#simulatorAmount", { timeout: 15000 }).type("5000000")
      cy.contains("button", "Simulate").click()

      cy.contains("fully pay off the loan").should("be.visible")
    })
  })

  it("shows partial interest message when no principal is reduced", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      // Enter a very small amount that only covers partial interest
      cy.get("#simulatorAmount", { timeout: 15000 }).type("1000")
      cy.contains("button", "Simulate").click()

      cy.contains("partial interest only").should("be.visible")
    })
  })

  it("simulate button is disabled when amount is empty", () => {
    cy.then(() => {
      cy.visit(`/loans/${loanId}`)
      cy.get("#simulatorAmount", { timeout: 15000 }).should("have.value", "")
      cy.contains("button", "Simulate").should("be.disabled")
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders loan detail with simulator at mobile and shows tab bar", () => {
      cy.then(() => {
        cy.visit(`/loans/${loanId}`)
        cy.contains("Principal Balance", { timeout: 15000 }).should("exist")
        cy.get("[data-testid='bottom-tab-bar']").should("exist")
          .should("have.css", "display", "flex")
        cy.get("[data-testid='sidebar-nav']").should("not.be.visible")
      })
    })

    it("simulator panel is accessible at mobile", () => {
      cy.then(() => {
        cy.visit(`/loans/${loanId}`)
        cy.contains("Repayment Simulator", { timeout: 15000 }).scrollIntoView().should("exist")
        cy.get("#simulatorAmount").scrollIntoView().should("be.visible")
        cy.contains("button", "Simulate").should("be.visible")
      })
    })
  })
})
