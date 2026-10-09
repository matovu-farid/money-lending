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

  function expectExportTotal(csv: string, amount: string, interest: string, principal: string, principalBalance: string) {
    expect(csv.trim().split("\n").at(-1)).to.equal(`Total payments,,"${amount}","${interest}","${principal}","${principalBalance}"`)
  }

  function exportCsv(assertCsv: (csv: string) => void, customerName = "Summary") {
    let exportedBlob: Blob
    cy.get("table [data-testid='data-row']").should(($rows) => {
      $rows.each((_index, row) => {
        expect(Cypress.$(row).find("td").first().text()).to.include(customerName)
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
    cy.get("[data-testid='payments-total']").should(($total) => {
      const summary = $total[0].getBoundingClientRect()
      const maxAmount = Cypress.$("input[placeholder='Any']")[0].getBoundingClientRect()
      expect(summary.width).to.be.lessThan(300)
      expect(summary.height).to.be.lessThan(60)
      expect(summary.left).to.be.greaterThan(maxAmount.right)
      expect(Math.abs(summary.bottom - maxAmount.bottom)).to.be.lessThan(2)
    })
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
      expectExportTotal(csv, "350,000", "0", "0", "4,000,000")
    })
  })

  it("exports a From-only date filter", () => {
    cy.visit("/payments?dateFrom=2026-10-01")
    expectTotal("400,000")
    exportCsv((csv) => {
      expect(csv.split("\n")[0]).to.equal('Date range,"From Oct 1, 2026"')
      expect(csv).not.to.include("Bob")
      expectExportTotal(csv, "400,000", "0", "0", "2,000,000")
    })
  })

  it("exports a To-only date filter", () => {
    cy.visit("/payments?dateTo=2026-09-15")
    expectTotal("350,000")
    exportCsv((csv) => {
      expect(csv.split("\n")[0]).to.equal('Date range,"Through Sep 15, 2026"')
      expectExportTotal(csv, "350,000", "0", "0", "4,000,000")
    })
  })

  it("keeps the column header first when no dates are selected", () => {
    cy.visit("/payments?customerName=Bob")
    expectTotal("250,000")
    exportCsv((csv) => {
      expect(csv.split("\n")[0]).to.equal("Date,Customer,Amount,Interest,Principal,Principal Balance")
      expect(csv).not.to.include("Date range")
      expect(csv).not.to.include("Alice Summary")
      // The embedded commas must be quoted to keep the six CSV columns intact.
      expect(csv).to.include('"250,000","0","0","2,000,000"')
      expect(csv).not.to.match(/\d\.\d/)
      expect(csv).not.to.include("UGX")
      expectExportTotal(csv, "250,000", "0", "0", "2,000,000")
    })
  })

  it("adds all four money totals at the bottom of an unfiltered export", () => {
    cy.visit("/payments")
    expectTotal("750,000")
    exportCsv((csv) => {
      expect(csv.trim().split("\n")).to.have.length(5)
      expectExportTotal(csv, "750,000", "0", "0", "6,000,000")
    })
  })

  it("formats all four money columns without decimals or a currency prefix", () => {
    cy.task("db:seedWeeklyReportsFixture")
    cy.visit("/payments?customerName=Weekly%20Report%20Loan%20A&amountMin=10000")
    cy.contains("td", "UGX 49,000", { timeout: 15000 }).scrollIntoView().should("be.visible")
    exportCsv((csv) => {
      expect(csv).to.include('"50,000","1,000","49,000","251,000"')
      expect(csv).not.to.match(/\d\.\d/)
      expect(csv).not.to.include("UGX")
      expectExportTotal(csv, "50,000", "1,000", "49,000", "251,000")
    }, "Weekly Report Loan A")
  })

  it("sums interest, principal, and balance over multiple exported loans and payments", () => {
    cy.task("db:seedWeeklyReportsFixture")
    cy.visit("/payments?customerName=Weekly%20Report%20Loan&amountMin=10000")
    expectTotal("160,000")
    cy.contains("td", "UGX 49,000", { timeout: 15000 }).scrollIntoView().should("be.visible")
    cy.contains("td", "UGX 41,333", { timeout: 15000 }).scrollIntoView().should("be.visible")
    exportCsv((csv) => {
      expect(csv.trim().split("\n")).to.have.length(5)
      expectExportTotal(csv, "160,000", "26,333", "133,667", "1,123,000")
    }, "Weekly Report Loan")
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
    cy.get("table [data-testid='data-row'] td:nth-child(2)").should(($dates) => {
      expect([...$dates].map((cell) => cell.textContent)).to.deep.equal([
        "Oct 9, 2026", "Oct 9, 2026", "Sep 15, 2026", "Sep 1, 2026",
      ])
    })
    expectTotal("1,010,000")
    exportCsv((csv) => {
      expect(csv.trim().split("\n")).to.have.length(32)
      expectExportTotal(csv, "1,010,000", "0", "0", "58,000,000")
      const lines = csv.trim().split("\n")
      expect(lines[2]).to.match(/^"Oct 9, 2026"/)
      expect(lines.at(-3)).to.match(/^"Sep 15, 2026"/)
      expect(lines.at(-2)).to.match(/^"Sep 1, 2026"/)
    })
  })

  it("orders the app table and CSV by payment date from newest to oldest", () => {
    cy.visit("/payments")
    expectTotal("750,000")
    cy.get("table [data-testid='data-row'] td:nth-child(2)").should(($dates) => {
      expect([...$dates].map((cell) => cell.textContent)).to.deep.equal([
        "Oct 9, 2026", "Sep 15, 2026", "Sep 1, 2026",
      ])
    })
    exportCsv((csv) => {
      const lines = csv.trim().split("\n")
      expect(lines[1]).to.match(/^"Oct 9, 2026"/)
      expect(lines[2]).to.match(/^"Sep 15, 2026"/)
      expect(lines[3]).to.match(/^"Sep 1, 2026"/)
    })
  })

  it("orders payments with the same payment date by newest creation time", () => {
    cy.task("db:seedPayment", { loanId, recordedBy: userId, amount: "450000", paymentDate: "2026-10-09T12:00:00Z" })
    cy.task("db:seedPayment", { loanId, recordedBy: userId, amount: "550000", paymentDate: "2026-10-09T12:00:00Z" })
    cy.visit("/payments")
    expectTotal("1,750,000")
    cy.get("table [data-testid='data-row'] td:nth-child(3)").should(($amounts) => {
      expect([...$amounts].map((cell) => cell.textContent)).to.deep.equal([
        "UGX 550,000", "UGX 450,000", "UGX 400,000", "UGX 250,000", "UGX 100,000",
      ])
    })
    exportCsv((csv) => {
      const lines = csv.trim().split("\n")
      expect(lines[1]).to.include('"550,000"')
      expect(lines[2]).to.include('"450,000"')
      expect(lines[3]).to.include('"400,000"')
    })
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
    cy.get("[data-testid='payments-total']").should(($total) => {
      const summary = $total[0].getBoundingClientRect()
      expect(summary.right).to.be.at.most(390)
      expect(summary.height).to.be.lessThan(60)
    })
    cy.get("button[aria-label='Toggle filters']").click()
    cy.get("input[placeholder='Any']").should("be.visible")
    cy.get("[data-testid='payments-total']").should("be.visible")
    cy.document().should((doc) => {
      expect(doc.documentElement.scrollWidth).to.be.at.most(390)
    })
  })
})
