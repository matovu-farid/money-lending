describe("Payments totals and spreadsheet export", () => {
  let loanId: string
  let userId: string

  beforeEach(() => {
    cy.viewport(1440, 1100)
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.createTestUser({ name: "Payments Summary Admin", role: "superAdmin" }).then((user) => {
      userId = user.userId
      cy.task<{ loanId: string }>("db:seedCustomerAndLoan", {
        customerName: "Alice Summary", contact: "0771000050", nin: "CM12345678ABCD",
        principalAmount: "2000000", issuedBy: userId,
      }).then((loan) => {
        loanId = loan.loanId
        cy.task("db:seedPayment", { loanId, recordedBy: userId, amount: "100000", paymentDate: "2026-09-01T12:00:00Z" })
        cy.task("db:seedPayment", { loanId, recordedBy: userId, amount: "400000", paymentDate: "2026-10-09T12:00:00Z" })
      })
      cy.task<{ loanId: string }>("db:seedCustomerAndLoan", {
        customerName: 'Bob "Summary"', contact: "0771000051", nin: "CM12345679ABCD",
        principalAmount: "2000000", issuedBy: userId,
      }).then((loan) => {
        cy.task("db:seedPayment", { loanId: loan.loanId, recordedBy: userId, amount: "250000", paymentDate: "2026-09-15T12:00:00Z" })
      })
    })
  })

  function expectTotal(amount: string) {
    cy.get("[data-testid='payments-total']", { timeout: 15000 })
      .should("be.visible").and("contain.text", "Total payments").and("contain.text", `UGX ${amount}`)
  }

  function exportCsv(assertCsv: (csv: string) => void) {
    let exportedBlob: Blob
    cy.get("table [data-testid='data-row']").should(($rows) => {
      $rows.each((_index, row) => {
        expect(Cypress.$(row).find("td").first().text()).to.include("Summary")
      })
    })
    cy.window().then((win) => {
      cy.stub(win.URL, "createObjectURL").callsFake((blob: Blob) => {
        exportedBlob = blob
        return "blob:payments-export"
      })
      cy.stub(win.HTMLAnchorElement.prototype, "click")
    })
    cy.contains("button", "Export CSV").should("not.be.disabled").click()
    cy.then(() => exportedBlob.text()).then(assertCsv)
  }

  it("shows the total of all payments and updates for customer and amount filters", () => {
    cy.visit("/payments")
    expectTotal("750,000")
    cy.get("input[placeholder='Search by customer name...']").type("Alice")
    expectTotal("500,000")
    cy.url().should("include", "customerName=Alice")
    cy.get("input[placeholder='0']").type("200000")
    expectTotal("400,000")
    cy.get("input[placeholder='Any']").type("300000")
    expectTotal("0")
    cy.contains("No payments match your filters").should("be.visible")
    cy.contains("button", "Export CSV").should("be.disabled")
    cy.contains("button", "Clear filters").first().click()
    expectTotal("750,000")
    cy.location("search").should("equal", "")
  })

  it("includes the entire end date in the total and exports the selected date range", () => {
    cy.visit("/payments?dateFrom=2026-09-01&dateTo=2026-09-15")
    expectTotal("350,000")
    exportCsv((csv) => {
      expect(csv.split("\n")[0]).to.equal('Date range,"Sep 1, 2026 to Sep 15, 2026"')
      expect(csv).to.include("Date,Customer,Amount,Interest,Principal,Principal Balance")
      expect(csv).to.include("Alice Summary")
      expect(csv).to.include('"Bob ""Summary"""')
      expect(csv).not.to.include("400000")
    })
  })

  it("exports a From-only date filter", () => {
    cy.visit("/payments?dateFrom=2026-10-01")
    expectTotal("400,000")
    exportCsv((csv) => {
      expect(csv.split("\n")[0]).to.equal('Date range,"From Oct 1, 2026"')
      expect(csv).not.to.include("Bob")
    })
  })

  it("exports a To-only date filter", () => {
    cy.visit("/payments?dateTo=2026-09-15")
    expectTotal("350,000")
    exportCsv((csv) => expect(csv.split("\n")[0]).to.equal('Date range,"Through Sep 15, 2026"'))
  })

  it("keeps the column header first when no dates are selected", () => {
    cy.visit("/payments?customerName=Bob")
    expectTotal("250,000")
    exportCsv((csv) => {
      expect(csv.split("\n")[0]).to.equal("Date,Customer,Amount,Interest,Principal,Principal Balance")
      expect(csv).not.to.include("Date range")
      expect(csv).not.to.include("Alice Summary")
    })
  })

  it("totals and exports every matching payment across pagination", () => {
    cy.then(() => {
      for (let index = 0; index < 26; index++) {
        cy.task("db:seedPayment", { loanId, recordedBy: userId, amount: "10000", paymentDate: "2026-10-09T12:00:00Z" })
      }
    })
    cy.visit("/payments?dateFrom=2026-09-01&dateTo=2026-10-09")
    expectTotal("1,010,000")
    cy.get("table [data-testid='data-row']").should("have.length", 25)
    cy.contains("button", "Next").click()
    cy.url().should("include", "page=2")
    cy.get("table [data-testid='data-row']").should("have.length", 4)
    expectTotal("1,010,000")
    exportCsv((csv) => expect(csv.trim().split("\n")).to.have.length(31))
  })

  it("shows zero when there are no payments", () => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.createTestUser({ name: "Empty Payments Admin", role: "superAdmin" })
    cy.visit("/payments")
    cy.contains("No payments recorded", { timeout: 15000 }).should("be.visible")
    expectTotal("0")
    cy.contains("button", "Export CSV").should("be.disabled")
  })

  it("shows the total on mobile", () => {
    cy.viewport(390, 844)
    cy.visit("/payments?customerName=Alice")
    expectTotal("500,000")
  })
})
