describe("Rollover interest uses actual accrual", () => {
  beforeEach(() => {
    cy.viewport(1440, 1100)
    cy.task("db:reset")
    cy.clearAppPersistence()
  })

  function seed(rolledOver: boolean, paidFirstMonth: boolean) {
    return cy.createTestUser({ name: "Rollover Admin", role: "superAdmin" }).then(({ userId }) =>
      cy.task<{ customerId: string; loanId: string }>("db:seedRolloverInterest", {
        actorId: userId, rolledOver, paidFirstMonth,
      }),
    )
  }

  it("carries eight days of unpaid interest after the first month was paid", () => {
    seed(false, true).then(({ customerId, loanId }) => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Unpaid interest: UGX 266,667", { timeout: 15000 }).scrollIntoView().should("be.visible")
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.contains("Accrued Interest").parent().should("contain.text", "266,667")
      cy.contains("Amount to Roll Over").parent().should("contain.text", "10,266,667")
      cy.get("#principalAmount").type("1000000")
      cy.contains("button", "Next").click()
      cy.get("#collateralNature").should("have.value", "Land Title")
      cy.contains("button", "Next").click()
      cy.contains("Interest accrues for the actual days elapsed on rolled-over loans.").should("be.visible")
      cy.contains("Minimum interest period applies even if repaid early").should("not.exist")
      cy.intercept("POST", "/loans/new*", (request) => {
        if (String(request.body).includes("carriedInterest")) request.alias = "saveRollover"
      })
      cy.contains("button", "Issue Loan").click()
      cy.wait("@saveRollover").its("response.body").should("not.match", /\n1:\{"error":"/)
      cy.dismissReceiptModal()
      cy.task<Array<{ id: string; principal_amount: string; status: string }>>("db:getLoans").then((loans) => {
        const successor = loans.find((loan) => loan.status === "active")!
        expect(successor.principal_amount).to.equal("11266667.00")
        cy.visit(`/loans/${successor.id}`)
        cy.contains("Unpaid interest: UGX 0", { timeout: 15000 }).scrollIntoView().should("be.visible")
      })
    })
  })

  it("shows and settles only actual interest on a rolled-over loan's first payment", () => {
    seed(true, false).then(({ loanId }) => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Unpaid interest: UGX 266,667", { timeout: 15000 }).scrollIntoView().should("be.visible")
      cy.contains("button", "Show Math").click()
      cy.contains("Total Due to Settle").parent().should("contain.text", "10,266,667")
      cy.visit(`/loans/${loanId}/payments/new`)
      cy.get("#amount").type("10266667")
      cy.contains("button", "Record Payment").click()
      cy.intercept("POST", `/loans/${loanId}/payments/new`, (request) => {
        if (String(request.body).includes("depositLocation")) request.alias = "savePayment"
      })
      cy.contains("button", "Confirm & Record").click()
      cy.wait("@savePayment").its("response.body").should("not.match", /\n1:\{"error":"/)
      cy.contains("This loan is fully paid.", { timeout: 15000 }).should("be.visible")
      cy.task<Array<{ id: string; status: string }>>("db:getLoans").then((loans) => {
        expect(loans.find((loan) => loan.id === loanId)?.status).to.equal("fully_paid")
      })
      cy.task<Array<{ id: string; loan_id: string }>>("db:getPayments").then((payments) => {
        const payment = payments.find((payment) => payment.loan_id === loanId)!
        cy.task<Array<{ amount: string; category_name: string; type: string }>>("db:getPaymentTransactions", { paymentId: payment.id }).then((entries) => {
          expect(entries.find((entry) => entry.category_name === "Interest Earned" && entry.type === "credit")?.amount).to.equal("266667.00")
          expect(entries.find((entry) => entry.category_name === "Loans Receivable" && entry.type === "credit")?.amount).to.equal("10000000.00")
        })
      })
    })
  })

  it("keeps the full first month for brand-new loans", () => {
    seed(false, false).then(({ loanId }) => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Unpaid interest: UGX 1,000,000", { timeout: 15000 }).scrollIntoView().should("be.visible")
      cy.contains("button", "Show Math").click()
      cy.contains("Total Due to Settle").parent().should("contain.text", "11,000,000")
    })
  })
})
