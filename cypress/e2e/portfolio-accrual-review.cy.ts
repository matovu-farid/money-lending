const asOf = "2025-01-31T23:59:59.999Z"

describe("Portfolio accrual repair review", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
  })

  it("keeps the read-only preview and approval away from unsigned visitors", () => {
    cy.request({ url: `/api/admin/portfolio-accrual-preview?loanId=10b5f8b9-42eb-44bd-aac3-d9d6e6657022&asOf=${encodeURIComponent(asOf)}`,
      failOnStatusCode: false }).its("status").should("eq", 401)
    cy.visit("/admin/portfolio-accrual-repair", { failOnStatusCode: false })
    cy.contains("Approve exact accrual plan").should("not.exist")
  })

  it("requires a complete exact-plan identity before offering approval", () => {
    cy.createTestUser({ name: "Accrual Admin", role: "superAdmin" })
    cy.visit("/admin/portfolio-accrual-repair")
    cy.contains("Exact reviewed plan required").should("be.visible")
    cy.contains("Approve exact accrual plan").should("not.exist")
  })

  it("shows the dated non-cash plan without requesting human sign-off", () => {
    cy.createTestUser({ name: "Accrual Admin", role: "superAdmin" }).then(({ userId }) => {
      cy.task("db:seedPortfolioAccrualReview", { actorId: userId }).then((fixture) => {
        const { loanId } = fixture as { loanId: string }
        cy.request(`/api/admin/portfolio-accrual-preview?loanId=${loanId}&asOf=${encodeURIComponent(asOf)}`)
          .its("body").then((plan) => {
            expect(plan.classification).to.eq("ready")
            expect(plan.entries).to.have.length(1)
            expect(plan.entries[0].delta).to.eq("100000.00")
            const query = new URLSearchParams({ loanId, asOf,
              planHash: plan.planHash, inputFingerprint: plan.inputFingerprint })
            cy.visit(`/admin/portfolio-accrual-repair?${query}`)
            cy.contains("Portfolio interest accrual review").should("be.visible")
            cy.contains("Cash receipts, payment dates, and loan principal remain unchanged.")
              .should("be.visible")
            cy.get('section[aria-label="Dated journal changes"] table tbody tr')
              .should("have.length", 1)
            cy.contains("Agent review and posting happen through the guarded correction operator.")
              .should("be.visible")
            cy.contains("button", "Approve exact accrual plan").should("not.exist")
            cy.get("#accrual-review-note").should("not.exist")
            cy.task("db:countPortfolioAccrualApprovals").should("eq", 0)
          })
      })
    })
  })
})
