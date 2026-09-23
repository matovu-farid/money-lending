const WEEK = "2026-09-21"

function printHeaders(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html")
  return [...document.querySelectorAll("thead th")].map((head) => head.textContent?.trim())
}

function suppressIframePrint(win: Window) {
  const prototype = win.HTMLIFrameElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "contentWindow")
  if (!descriptor?.get) return
  Object.defineProperty(prototype, "contentWindow", {
    configurable: true,
    get() {
      const child = descriptor.get!.call(this) as Window | null
      if (child) child.print = () => undefined
      return child
    },
  })
}

describe("Weekly reports", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    cy.createTestUser({ name: "Weekly Reports Admin", role: "superAdmin" })
  })

  it("keeps this app's session after a full report reload", () => {
    cy.getCookie("kaks-credit.session_token").should("exist")
    cy.visit(`/reports/weekly-payments?week=${WEEK}`)
    cy.reload()
    cy.contains("h1", "Weekly Payments", { timeout: 15000 }).should("be.visible")
    cy.location("pathname").should("eq", "/reports/weekly-payments")
  })

  it("shows ledger-backed current-week payments, including loan B's preceding-week balance history", () => {
    cy.task("db:seedWeeklyReportsFixture").then((fixture) => {
      expect(fixture).to.have.property("priorPaymentId")
      cy.visit(`/reports/weekly-payments?week=${WEEK}`)

      cy.contains("h1", "Weekly Payments", { timeout: 15000 }).should("be.visible")
      cy.contains("p", /^Payments\s+2$/).should("be.visible")
      cy.contains("p", /^Total received/).should("contain", "110,000")
      cy.get("thead th").then(($heads) => {
        expect([...$heads].map((head) => head.textContent?.trim())).to.deep.equal([
          "Customer", "Date", "Amount", "Interest", "Principal", "Principal Balance",
        ])
      })
      cy.get("tbody tr").should("have.length", 2)
      cy.contains("Weekly Report Loan A").should("be.visible")
      cy.contains("Weekly Report Loan B").should("be.visible")
      cy.contains("tr", "Weekly Report Loan A").should("contain", "23 Sept 2026").and("contain", "50,000")
      cy.contains("tr", "Weekly Report Loan B").should("contain", "23 Sept 2026").and("contain", "60,000")
      cy.contains("Weekly Report Pending").should("not.exist")
      cy.contains("Weekly Report Deleted").should("not.exist")
      cy.contains("Weekly Report Boundary").should("not.exist")
      cy.contains("Weekly Report Loan B").closest("tr").should("contain", "415,333")
    })
  })

  it("shows only loans issued this week with the Loans report's eight columns and live balances", () => {
    cy.task("db:seedWeeklyReportsFixture")
    cy.visit(`/reports/weekly-loans?week=${WEEK}`)

    cy.contains("h1", "Weekly Loans", { timeout: 15000 }).should("be.visible")
    cy.contains("p", /^Loans issued\s+1$/).should("be.visible")
    cy.contains("p", /^Principal total/).should("contain", "300,000")
    cy.get("thead th").then(($heads) => {
      expect([...$heads].map((head) => head.textContent?.trim())).to.deep.equal([
        "Customer Name", "Contact", "Principal Amount", "Principal Balance", "Total Due", "Accrued Interest", "Days Overdue", "Last Payment",
      ])
    })
    cy.get("tbody tr").should("have.length", 1)
    cy.contains("Weekly Report Loan A").should("be.visible")
    cy.contains("Weekly Report Loan A").closest("tr").should("contain", "300,000").and("contain", "251,000")
    cy.contains("Weekly Report Loan B").should("not.exist")
    cy.contains("Weekly Report Pending").should("not.exist")
    cy.contains("Weekly Report Deleted").should("not.exist")
  })

  it("prints the refreshed weekly snapshot with the same columns, rows, range, and totals", () => {
    cy.task("db:seedWeeklyReportsFixture").then((fixture) => {
    cy.visit(`/reports/weekly-loans?week=${WEEK}`, { onBeforeLoad: suppressIframePrint })
    cy.contains("h1", "Weekly Loans", { timeout: 15000 }).should("be.visible")
    cy.contains("button", "Print").should("be.enabled").click()
    cy.get('iframe[title="Weekly report print preview"]').should("exist").and(($iframe) => {
      const html = $iframe.attr("srcdoc") ?? $iframe[0].contentDocument?.documentElement?.innerHTML ?? ""
      expect(html).to.contain("Weekly Loans")
      expect(html).to.contain("21 Sept 2026")
      expect(html).to.contain("27 Sept 2026")
      expect(html).to.contain("Weekly Report Loan A")
      expect(html).not.to.contain("Weekly Report Loan B")
      expect(html).to.contain("Principal Balance")
      expect(html).to.contain("Total Due")
      expect(printHeaders(html)).to.deep.equal([
        "Customer Name", "Contact", "Principal Amount (UGX)", "Principal Balance (UGX)", "Total Due (UGX)", "Accrued Interest (UGX)", "Days Overdue", "Last Payment",
      ])
    })
    cy.get('iframe[title="Weekly report print preview"]').then(($iframe) => {
      const before = $iframe.attr("srcdoc") ?? $iframe[0].contentDocument?.documentElement?.innerHTML ?? ""
      cy.task("db:changeWeeklyReportLedger", { paymentId: fixture.loanAPaymentId }).then(() => {
        cy.contains("button", "Print").should("be.enabled").click()
        cy.get('iframe[title="Weekly report print preview"]').should(($freshIframe) => {
          const fresh = $freshIframe.attr("srcdoc") ?? $freshIframe[0].contentDocument?.documentElement?.innerHTML ?? ""
          expect(fresh).not.to.equal(before)
          expect(fresh).to.contain("Weekly Report Loan A")
          expect(fresh).to.contain("Principal Balance")
          expect(fresh).to.contain("253,000")
          expect(fresh).to.contain("As of:")
        })
      })
    })

    cy.visit(`/reports/weekly-payments?week=${WEEK}`, { onBeforeLoad: suppressIframePrint })
    cy.contains("h1", "Weekly Payments", { timeout: 15000 }).should("be.visible")
    cy.contains("button", "Print").should("be.enabled").click()
    cy.get('iframe[title="Weekly report print preview"]').should("exist").and(($iframe) => {
      const html = $iframe.attr("srcdoc") ?? $iframe[0].contentDocument?.documentElement?.innerHTML ?? ""
      expect(html).to.contain("Weekly Payments")
      expect(html).to.contain("Weekly Report Loan A")
      expect(html).to.contain("Weekly Report Loan B")
      expect(html).to.contain("Interest")
      expect(html).to.contain("Principal")
      expect(html).to.contain("Principal Balance")
      expect(html).to.contain("110,000")
      expect(printHeaders(html)).to.deep.equal([
        "Customer", "Date", "Amount (UGX)", "Interest (UGX)", "Principal (UGX)", "Principal Balance (UGX)",
      ])
    })
    })
  })

  it("moves between weeks in the URL and normalizes selected dates to Monday", () => {
    cy.visit(`/reports/weekly-payments?week=${WEEK}`)
    cy.contains("p", /^Payments\s+0$/).should("be.visible")
    cy.get('button[aria-label="Previous week"]').click()
    cy.location("search").should("eq", "?week=2026-09-14")
    cy.get('button[aria-label="Next week"]').click()
    cy.location("search").should("eq", `?week=${WEEK}`)
    cy.get("#weekly-report-week").clear().type("2026-09-23")
    cy.location("search").should("eq", `?week=${WEEK}`)
    cy.get("#weekly-report-week").should("have.value", WEEK)
  })

  it("shows an invalid-week message for a non-Monday or malformed week", () => {
    cy.visit("/reports/weekly-payments?week=2026-09-22")
    cy.get('[role="alert"]').should("contain", "Invalid week")
    cy.get("#weekly-report-week").should("not.exist")

    cy.visit("/reports/weekly-loans?week=2026-02-30")
    cy.get('[role="alert"]').should("contain", "Invalid week")
  })

  it("shows the empty state for a valid week with no records", () => {
    cy.visit("/reports/weekly-payments?week=2026-08-03")
    cy.contains("No payments for this week.", { timeout: 15000 }).should("be.visible")
    cy.contains("p", /^Total received/).should("contain", "0")
    cy.visit("/reports/weekly-loans?week=2026-08-03")
    cy.contains("No loans issued this week.", { timeout: 60000 }).should("be.visible")
  })

  it("renders weekly report cards and report rows on mobile", () => {
    cy.viewport(390, 844)
    cy.visit("/reports")
    cy.contains("Weekly Payments").should("be.visible")
    cy.contains("Weekly Loans").should("be.visible")
    cy.get("[data-testid='bottom-tab-bar']").should("be.visible")

    cy.task("db:seedWeeklyReportsFixture")
    cy.visit(`/reports/weekly-payments?week=${WEEK}`)
    cy.contains("h1", "Weekly Payments", { timeout: 15000 }).should("be.visible")
    cy.get("[data-testid='data-row']").should("have.length", 2)
    cy.get("[data-testid='data-row']").contains("Weekly Report Loan A").scrollIntoView().should("be.visible")
    cy.contains("p", /^Total received/).should("contain", "110,000")
  })

  it("shows weekly report cards to loan officers and hides financial reports", () => {
    cy.task("db:reset")
    cy.createTestUser({ name: "Weekly Reports Officer", role: "loanOfficer" })
    cy.visit("/reports")
    cy.contains("Weekly Payments").should("be.visible")
    cy.contains("Weekly Loans").should("be.visible")
    cy.contains("Profit & Loss").should("not.exist")
    cy.contains("Balance Sheet").should("not.exist")
    cy.visit(`/reports/weekly-payments?week=${WEEK}`)
    cy.contains("h1", "Weekly Payments", { timeout: 15000 }).should("be.visible")
    cy.visit(`/reports/weekly-loans?week=${WEEK}`)
    cy.contains("h1", "Weekly Loans", { timeout: 15000 }).should("be.visible")
  })

  it("denies an unassigned user access to both weekly report routes", () => {
    cy.clearCookies()
    const email = `weekly-unassigned-${Date.now()}@fidexa.org`
    cy.visit("/register")
    cy.get("#name").type("Unassigned Weekly User")
    cy.get("#email").type(email)
    cy.get("#password").type("TestPass123!")
    cy.get("#confirmPassword").type("TestPass123!")
    cy.get("button[type=submit]").click()
    cy.url({ timeout: 60000 }).should("include", "/pending-approval")

    cy.visit(`/reports/weekly-payments?week=${WEEK}`)
    cy.url({ timeout: 10000 }).should("include", "/pending-approval")
    cy.visit(`/reports/weekly-loans?week=${WEEK}`)
    cy.url({ timeout: 10000 }).should("include", "/pending-approval")
  })
})
