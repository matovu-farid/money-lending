describe("Rollover interest uses actual accrual", () => {
  beforeEach(() => {
    cy.viewport(1440, 1100)
    cy.task("db:reset")
    cy.clearAppPersistence()
  })

  function seed(rolledOver: boolean, paidFirstMonth: boolean, capitalizedInterest?: string) {
    return cy.createTestUser({ name: "Rollover Admin", role: "superAdmin" }).then(({ userId }) =>
      cy.task<{ customerId: string; loanId: string }>("db:seedRolloverInterest", {
        actorId: userId, rolledOver, paidFirstMonth, capitalizedInterest,
      }),
    )
  }

  it("shows capitalized interest separately and allocates the next payment to new interest", () => {
    seed(true, false, "308500").then(({ loanId }) => {
      cy.visit(`/loans/${loanId}`)
      cy.contains("Unpaid interest: UGX 274,893", { timeout: 15000 }).should("be.visible")
      cy.contains("button", "Show Math").click()
      cy.get("[data-testid='loan-statement-dialog-content']").within(() => {
        cy.contains("Interest Capitalized at Rollover").should("be.visible")
        cy.contains("Cumulative Interest Paid").parent().should("contain.text", "UGX 0")
        cy.contains("Cumulative Interest Accrued").parent().should("contain.text", "UGX 274,893")
        cy.contains("Net Unpaid Interest").parent().should("contain.text", "UGX 274,893")
        cy.contains("Total Due to Settle").parent().should("contain.text", "UGX 10,583,393")
        cy.contains("Days Overdue").parent().should("contain.text", "8 days")
      })
      cy.visit(`/loans/${loanId}/payments/new`)
      cy.get("#amount").type("100000")
      cy.contains("button", "Record Payment").click()
      cy.intercept("POST", `/loans/${loanId}/payments/new`, (request) => {
        if (String(request.body).includes("depositLocation")) request.alias = "saveCapitalizedRolloverPayment"
      })
      cy.contains("button", "Confirm & Record").click()
      cy.wait("@saveCapitalizedRolloverPayment").its("response.body").should("not.match", /\n1:\{"error":/)
      cy.task<Array<{ id: string; loan_id: string }>>("db:getPayments").then((payments) => {
        const payment = payments.find((entry) => entry.loan_id === loanId)!
        cy.task<Array<{ amount: string; category_name: string; type: string }>>("db:getPaymentTransactions", { paymentId: payment.id }).then((entries) => {
          expect(entries.find((entry) => entry.category_name === "Interest Earned" && entry.type === "credit")?.amount).to.equal("100000.00")
          expect(entries.find((entry) => entry.category_name === "Loans Receivable" && entry.type === "credit")).to.equal(undefined)
        })
      })
    })
  })

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

  it("quotes a backdated rollover at its effective date and closes the predecessor statement", () => {
    seed(false, true).then(({ customerId, loanId }) => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      cy.visit(`/loans/new?customerId=${customerId}`)
      cy.get("#startDate").click()
      cy.get(`[data-day="${yesterday.toLocaleDateString()}"]`).click()
      cy.get("#backdateNote").type("Effective date confirmed from signed rollover agreement")
      cy.contains("Accrued Interest").parent().should("contain.text", "233,333")
      cy.contains("Amount to Roll Over").parent().should("contain.text", "10,233,333")
      cy.get("#principalAmount").type("1000000")
      cy.contains("button", "Next").click()
      cy.contains("button", "Next").click()
      cy.intercept("POST", "/loans/new*", (request) => {
        if (String(request.body).includes("carriedInterest")) request.alias = "saveBackdatedRollover"
      })
      cy.contains("button", "Issue Loan").click()
      cy.wait("@saveBackdatedRollover").its("response.body").should("not.match", /\n1:\{"error":/)
      cy.contains("Loan Disbursement Receipt", { timeout: 15000 }).should("be.visible")
      cy.contains("11,233,333").should("be.visible")
      cy.task<Array<{ id: string; principal_amount: string; status: string }>>("db:getLoans").then((rows) => {
        const successor = rows.find((row) => row.status === "active")!
        expect(successor.principal_amount).to.equal("11233333.00")
        cy.visit(`/loans/${loanId}`)
        cy.contains("Balance transferred to successor — not repaid").should("be.visible")
        cy.contains("100% repaid").should("not.exist")
        cy.contains("No payments recorded").should("be.visible")
        cy.contains("Record the first payment against this loan").should("not.exist")
        cy.contains("button", "Show Math").click()
        cy.get("[data-testid='loan-statement-dialog-content']").within(() => {
          cy.contains("Rolled Into Successor").should("be.visible")
          cy.contains("Recorded balance transferred to successor; no cash payment").should("be.visible")
          cy.contains("Still Collectible on This Loan").parent().should("contain.text", "UGX 0")
        })
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

  it("does not show a misleading collectible statement when a successor was deleted", () => {
    seed(true, false).then(({ loanId }) => {
      cy.task("db:softDeleteLoan", { loanId })
      cy.task<Array<{ id: string; status: string }>>("db:getLoans").then((loans) => {
        const predecessor = loans.find((loan) => loan.status === "rolled_over")!
        cy.visit(`/loans/${predecessor.id}`)
        cy.contains("button", "Show Math").click()
        cy.get("[data-testid='loan-statement-unavailable']").within(() => {
          cy.contains("Statement unavailable").should("be.visible")
          cy.contains("no active successor can be found").should("be.visible")
        })
        cy.get("[data-testid='loan-statement-dialog-content']").should("not.exist")
      })
    })
  })

  it("withholds a predecessor statement when the successor predates its start", () => {
    seed(true, false).then(() => {
      cy.task<Array<{ id: string; status: string }>>("db:getLoans").then((loans) => {
        const predecessor = loans.find((loan) => loan.status === "rolled_over")!
        const future = new Date()
        future.setDate(future.getDate() + 1)
        cy.task("db:setLoanStartDate", { loanId: predecessor.id, startDate: future.toISOString() })
        cy.visit(`/loans/${predecessor.id}`)
        cy.contains("button", "Show Math").click()
        cy.get("[data-testid='loan-statement-unavailable']").within(() => {
          cy.contains("successor issue date is before this loan started").should("be.visible")
        })
        cy.get("[data-testid='loan-statement-dialog-content']").should("not.exist")
      })
    })
  })

  it("shows a pending predecessor receivable instead of claiming zero due", () => {
    cy.createTestUser({ name: "Rollover Admin", role: "superAdmin" }).then(({ userId }) => {
      cy.task<{ loanId: string }>("db:seedRolloverInterest", {
        actorId: userId, rolledOver: true, paidFirstMonth: false,
      }).then(() => {
        cy.task<Array<{ id: string; status: string }>>("db:getLoans").then((loans) => {
          const predecessor = loans.find((loan) => loan.status === "rolled_over")!
          cy.task("db:addUnresolvedReceivable", { loanId: predecessor.id, actorId: userId })
          cy.visit(`/loans/${predecessor.id}`)
          cy.contains("button", "Show Math").click()
          cy.get("[data-testid='loan-statement-dialog-content']").within(() => {
            cy.contains("Unresolved Receivable on This Loan").parent()
              .should("contain.text", "UGX 500,000")
            cy.contains("Calculated Due at Transfer").should("exist")
            cy.contains("Still Collectible on This Loan").should("not.exist")
          })
        })
      })
    })
  })
})
