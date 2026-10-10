type SeededLoan = { customerId: string; loanId: string }
type TestUser = { userId: string }
type RateReviewState = {
  status: string
  interestRateOverride: string | null
  appliedAuditCount: number
}

describe("Retroactive loan-rate correction", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
  })

  it("shows an eligible backdated correction from the loan start date", () => {
    cy.createTestUser({ name: "Rate Correction Admin", role: "superAdmin" }).then(({ userId }) => {
      cy.task("db:seedRolloverInterest", {
        actorId: userId, rolledOver: false, paidFirstMonth: false,
      }).then((seeded: SeededLoan) => {
        cy.task("db:setLoanStartDate", {
          loanId: seeded.loanId,
          startDate: "2025-02-21T00:00:00.000Z",
        })
        cy.visit(`/loans/${seeded.loanId}`)
        cy.contains("button", "Adjust Interest Rate").should("be.visible")
        cy.contains("button", "Adjust Interest Rate").click()
        cy.get("#admin-new-rate").clear().type("8")
        cy.contains("button", "Save Rate").click()
        cy.contains("Interest rate adjusted", { timeout: 15000 }).should("exist")
        cy.visit(`/loans/${seeded.loanId}`)

        cy.contains("View rate history").click()
        cy.contains("Interest corrected from").should("be.visible")
        cy.contains("Feb").should("be.visible")
        cy.contains("2025").should("be.visible")
        cy.get("[role=dialog]").contains("Applied").should("be.visible")
        cy.get("[role=dialog]").contains("button", "Close").click({ force: true })

        cy.contains("button", "Show Math").click()
        cy.contains("Loan Terms").should("be.visible")
        cy.contains("8% / month").should("be.visible")
        cy.contains("RATE CHANGED").should("not.exist")
      })
    })
  })

  it("shows a clear payment lock error and does not change the displayed rate", () => {
    cy.createTestUser({ name: "Rate Lock Admin", role: "superAdmin" }).then(({ userId }) => {
      cy.task("db:seedRolloverInterest", {
        actorId: userId, rolledOver: false, paidFirstMonth: true,
      }).then((seeded: SeededLoan) => {
        cy.visit(`/loans/${seeded.loanId}`)
        cy.contains("button", "Adjust Interest Rate").click()
        cy.get("#admin-new-rate").clear().type("8")
        cy.contains("button", "Save Rate").click()
        cy.contains("a payment has been recorded on this loan", { timeout: 15000 }).should("be.visible")
        cy.contains("Interest rate adjusted").should("not.exist")
      })
    })
  })

  it("does not report a locked loan's rate-change request as submitted", () => {
    cy.createTestUser({ name: "Rate Request Seed Admin", role: "superAdmin" }).then(({ userId }) => {
      cy.task("db:seedRolloverInterest", {
        actorId: userId, rolledOver: false, paidFirstMonth: true,
      }).then((seeded: SeededLoan) => {
        cy.createTestUser({ name: "Locked Rate Requester", role: "loanOfficer" })
        cy.visit(`/loans/${seeded.loanId}`)
        cy.contains("button", "Request Rate Change").click()
        cy.get("#newRate").clear().type("8")
        cy.contains("button", "Submit Request").click()
        cy.contains("Failed to submit rate change request", { timeout: 15000 }).should("be.visible")
        cy.contains("Rate change request submitted").should("not.exist")
      })
    })
  })

  for (const kind of ["waiver", "rollover"] as const) {
    it(`shows the ${kind} lock even when the event was undone`, () => {
      cy.createTestUser({ name: `Rate ${kind} Admin`, role: "superAdmin" }).then(({ userId }) => {
        cy.task("db:seedRolloverInterest", {
          actorId: userId, rolledOver: false, paidFirstMonth: false,
        }).then((seeded: SeededLoan) => {
          cy.task("db:seedRateLockEvent", { loanId: seeded.loanId, actorId: userId, kind })
          cy.visit(`/loans/${seeded.loanId}`)
          cy.contains("button", "Adjust Interest Rate").click()
          cy.get("#admin-new-rate").clear().type("8")
          cy.contains("button", "Save Rate").click()
          cy.contains(`a ${kind} has been recorded on this loan`, { timeout: 15000 }).should("be.visible")
          cy.contains("Interest rate adjusted").should("not.exist")
        })
      })
    })
  }

  it("does not show a guessed statement for ambiguous same-day legacy rate edits", () => {
    cy.createTestUser({ name: "Legacy Rate Reviewer", role: "superAdmin" }).then(({ userId }) => {
      cy.task("db:seedRolloverInterest", {
        actorId: userId, rolledOver: false, paidFirstMonth: false,
      }).then((seeded: SeededLoan) => {
        cy.task("db:seedAmbiguousRateHistory", { loanId: seeded.loanId, actorId: userId })
        cy.visit(`/loans/${seeded.loanId}`)
        cy.contains("button", "Show Math").click()
        cy.get("[data-testid=loan-statement-unavailable]").should("be.visible")
        cy.contains("Applied rate changes on the same day need review").should("be.visible")
        cy.get("[data-testid=loan-statement-dialog-content]").should("not.exist")
      })
    })
  })

  it("keeps a pending request pending when a later payment blocks approval", () => {
    cy.task("auth:createUser", { name: "Rate Requester", role: "loanOfficer" }).then((requester: TestUser) => {
      cy.createTestUser({ name: "Rate Reviewer", role: "superAdmin" }).then(({ userId }) => {
        cy.task("db:seedRolloverInterest", {
          actorId: userId, rolledOver: false, paidFirstMonth: false,
        }).then((seeded: SeededLoan) => {
          cy.task("db:seedPendingRateRequestAndPayment", {
            loanId: seeded.loanId, requestedBy: requester.userId, paymentBy: userId,
          }).then((requestId: string) => {
            cy.visit("/approvals")
            cy.contains("Pending Requests").should("be.visible")
            cy.get('button[aria-label="Approve"]').click()
            cy.contains("button", "Approve & Apply").click()
            cy.contains("a payment has been recorded on this loan", { timeout: 15000 }).should("be.visible")
            cy.contains("Rate change approved and applied").should("not.exist")
            cy.task("db:getRateReviewState", { loanId: seeded.loanId, requestId }).then((state: RateReviewState) => {
              expect(state.status).to.eq("pending")
              expect(state.interestRateOverride).to.eq(null)
              expect(state.appliedAuditCount).to.eq(0)
            })
          })
        })
      })
    })
  })

  it("refreshes cached rate history after approving a correction", () => {
    cy.task("auth:createUser", { name: "History Requester", role: "loanOfficer" }).then((requester: TestUser) => {
      cy.createTestUser({ name: "History Reviewer", role: "superAdmin" }).then(({ userId }) => {
        cy.task("db:seedRolloverInterest", {
          actorId: userId, rolledOver: false, paidFirstMonth: false,
        }).then((seeded: SeededLoan) => {
          cy.task("db:seedPendingRateRequestAndPayment", {
            loanId: seeded.loanId, requestedBy: requester.userId, paymentBy: userId, addPayment: false,
          }).then((requestId: string) => {
            cy.visit(`/loans/${seeded.loanId}`)
            cy.contains("View rate history").should("not.exist")
            cy.visit("/approvals")
            cy.get('button[aria-label="Approve"]').click()
            cy.contains("button", "Approve & Apply").click()
            cy.contains("Rate change approved and applied", { timeout: 15000 }).should("be.visible")
            cy.visit(`/loans/${seeded.loanId}`)
            cy.contains("View rate history", { timeout: 15000 }).click()
            cy.contains("Interest corrected from").should("be.visible")
            cy.task("db:getRateReviewState", { loanId: seeded.loanId, requestId }).then((state: RateReviewState) => {
              expect(state.status).to.eq("approved")
              expect(state.interestRateOverride).to.eq("0.0800")
              expect(state.appliedAuditCount).to.eq(1)
            })
          })
        })
      })
    })
  })

  it("refreshes rate history when a request applies immediately", () => {
    cy.createTestUser({ name: "Immediate Rate Seed Admin", role: "superAdmin" }).then(({ userId }) => {
      cy.task("db:seedRolloverInterest", {
        actorId: userId, rolledOver: false, paidFirstMonth: false,
      }).then((seeded: SeededLoan) => {
        cy.createTestUser({ name: "Immediate Rate Requester", role: "loanOfficer" })
        cy.visit(`/loans/${seeded.loanId}`)
        cy.contains("button", "Request Rate Change").click()
        cy.get("#newRate").clear().type("11")
        cy.contains("button", "Submit Request").click()
        cy.contains("Rate change request submitted", { timeout: 15000 }).should("exist")
        cy.contains("View rate history", { timeout: 15000 }).click()
        cy.contains("Interest corrected from").should("be.visible")
        cy.get("[role=dialog]").contains("10.0% → 11.0%").should("be.visible")
      })
    })
  })
})
