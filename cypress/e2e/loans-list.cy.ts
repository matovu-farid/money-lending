function seedCustomerAndLoan(customerName: string, contact: string, amount: string) {
  return cy.get<string>("@testUserId").then((issuedBy) =>
    cy
      .task("db:seedCustomerAndLoan", {
        customerName,
        contact,
        nin: `CF${contact.slice(-10)}RL`,
        principalAmount: amount,
        issuedBy,
      })
      .then((seeded) => cy.wrap(seeded))
  )
}

function getLoansPrintDocument() {
  return cy
    .get('iframe[title="Loans print preview"]', { timeout: 10000 })
    .should(($iframe) => {
      expect(Boolean($iframe[0].contentDocument?.querySelector("thead th"))).to.equal(true)
    })
    .then(($iframe) => $iframe[0].contentDocument!)
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

function colorChannels(color: string, doc: Document): [number, number, number, number] {
  const canvas = doc.createElement("canvas")
  canvas.width = canvas.height = 1
  const context = canvas.getContext("2d")!
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const channels = context.getImageData(0, 0, 1, 1).data
  return [channels[0], channels[1], channels[2], channels[3]]
}

function contrastRatio(foreground: string, background: string, doc: Document): number {
  const fg = colorChannels(foreground, doc)
  const bg = colorChannels(background, doc)
  const alpha = fg[3] / 255
  const luminance = (channels: number[]) => {
    const linear = channels.map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  }
  const text = fg.slice(0, 3).map((channel, index) => channel * alpha + bg[index] * (1 - alpha))
  const [lighter, darker] = [luminance(text), luminance(bg.slice(0, 3))].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

describe("Loans List (Unified)", () => {
  beforeEach(() => {
    cy.task("db:reset")
    cy.clearAppPersistence()
    const email = `loans-list-${Date.now()}@fidexa.org`
    cy.createTestUser({ name: "Loan Officer", email, role: "loanOfficer" }).then((user) => {
      cy.wrap(user.userId).as("testUserId")
      cy.visit("/dashboard")
      cy.url({ timeout: 15000 }).should("include", "/dashboard")
    })
  })

  context("empty state", () => {
    it("shows empty state when no loans exist", () => {
      cy.visit("/loans")
      cy.contains("h2", "No loans yet.", { timeout: 10000 }).should("be.visible")
      cy.contains("Issue your first loan by selecting a customer.").should("be.visible")
      cy.contains("button", "Issue Loan").should("be.visible")
    })
  })

  context("with loan data", () => {
    beforeEach(() => {
      seedCustomerAndLoan("Test Borrower", "0700000001", "1000000").then(({ customerId }) =>
        cy.wrap(customerId).as("testCustomerId")
      )
    })

    it("shows page heading and subtitle", () => {
      cy.visit("/loans")
      cy.get("h1", { timeout: 10000 }).contains("Loans").should("be.visible")
      cy.contains("All loans sorted by risk level").should("be.visible")
      cy.contains("Last calculated:").should("be.visible")
    })

    it("displays stat cards with correct labels", () => {
      cy.visit("/loans")
      cy.contains("Critical (30+ days)", { timeout: 10000 }).should("be.visible")
      cy.contains("At Risk (25-29 days)").should("be.visible")
      cy.contains("Early (0-24 days)").should("be.visible")
      cy.contains("All Loans").should("be.visible")
      cy.contains("button", "Early (0-24 days)").should(($card) => {
        expect($card.text()).to.contain("UGX 1,000,000 outstanding")
      })
    })

    it("displays filter tabs with counts", () => {
      cy.visit("/loans")
      cy.contains("button", "All Loans", { timeout: 10000 }).should("be.visible")
      cy.contains("button", "Critical (30+ days)").should("be.visible")
      cy.contains("button", "At Risk (25-29 days)").should("be.visible")
      cy.contains("button", "Early (0-24 days)").should("be.visible")
    })

    it("clicking stat card activates matching filter", () => {
      cy.visit("/loans")
      cy.contains("button", "All Loans").should("have.attr", "aria-pressed", "true")
      cy.contains("Showing: All Loans").should("be.visible")
      cy.contains("Critical (30+ days)", { timeout: 10000 }).closest("button")
        .should("have.css", "cursor", "pointer")
      cy.contains("Critical (30+ days)", { timeout: 10000 }).closest("button").click()
      cy.contains("Critical (30+ days)").closest("button")
        .should("have.attr", "aria-pressed", "true")
        .and("have.class", "ring-2")
      cy.contains("button", "All Loans").should("have.attr", "aria-pressed", "false")
      cy.contains("Showing: Critical (30+ days)").should("be.visible")
      cy.contains("Critical (30+ days)").closest("button")
        .should("have.class", "bg-foreground")
      cy.contains("Critical (30+ days)").closest("button").click()
      cy.contains("Showing: All Loans").should("be.visible")
      cy.contains("button", "All Loans").should("have.attr", "aria-pressed", "true")
    })

    it("keeps the selected filter visibly inverted and readable in both themes", () => {
      cy.visit("/loans")
      cy.contains("Critical (30+ days)", { timeout: 10000 }).closest("button").click()

      const checkContrast = (theme: "light" | "dark") => {
        cy.get("html").should(theme === "dark" ? "have.class" : "not.have.class", "dark")
        cy.contains("Critical (30+ days)").closest("button").should(($card) => {
          const card = $card[0]
          const doc = card.ownerDocument
          const view = doc.defaultView!
          const background = view.getComputedStyle(card).backgroundColor
          const inactive = [...card.parentElement!.querySelectorAll("button")].find((button) => button !== card)!
          const inactiveBackground = view.getComputedStyle(inactive).backgroundColor
          expect(contrastRatio(background, inactiveBackground, doc), `${theme} selected card prominence`).to.be.at.least(7)

          const label = card.querySelector("p")!
          const count = card.querySelector(".text-3xl")!
          const subtitle = card.querySelector("div.space-y-3 > p:last-child")!
          const info = card.querySelector('[aria-label="More information"]')!
          for (const [name, element] of [["label", label], ["count", count], ["subtitle", subtitle], ["info icon", info]] as const) {
            const foreground = view.getComputedStyle(element).color
            expect(contrastRatio(foreground, background, doc), `${theme} ${name} contrast`).to.be.at.least(4.5)
          }
        })
      }

      cy.get("body").then(($body) => {
        if ($body.find('button[aria-label="Switch to light mode"]').length) {
          cy.get('button[aria-label="Switch to light mode"]').click()
        }
      })
      checkContrast("light")
      cy.get('button[aria-label="Switch to dark mode"]').click()
      checkContrast("dark")
    })

    it("Issue Loan button navigates to /loans/new", () => {
      cy.visit("/loans")
      cy.contains("button", "Issue Loan", { timeout: 10000 }).first().click()
      cy.contains("h2", "Select Customer", { timeout: 10000 }).should("be.visible")
      cy.contains("button", "Test Borrower", { timeout: 10000 }).click()
      cy.get<string>("@testCustomerId").then((customerId) => {
        cy.url({ timeout: 30000 }).should("include", `/loans/new?customerId=${customerId}`)
      })
    })

    it("filters loans by matching customer name", () => {
      cy.visit("/loans")
      cy.contains("Test Borrower", { timeout: 10000 }).should("be.visible")

      cy.get("input[placeholder='Search by customer name...']").type("Test")

      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
      cy.get("[data-testid='data-row']").filter(":visible").first().should("contain", "Test Borrower")
    })

    it("Print button exists", () => {
      cy.visit("/loans")
      cy.contains("button", "Print", { timeout: 10000 }).should("be.visible")
    })

    it("table shows correct columns", () => {
      cy.viewport(1280, 900)
      cy.visit("/loans")
      cy.contains("Customer Name", { timeout: 10000 }).should("exist")
      cy.contains("Principal Amount").should("exist")
      cy.contains("Principal Balance").should("exist")
      cy.contains("Total Due").should("exist")
      cy.contains("Days Overdue").should("exist")
      cy.contains("Last Payment").should("exist")
    })

    it("shows UGX with loan row amounts on desktop", () => {
      cy.viewport(1280, 900)
      cy.visit("/loans")
      cy.contains("[data-testid='data-row']", "Test Borrower", { timeout: 10000 }).should(($row) => {
        expect($row.text()).to.contain("UGX 1,000,000")
      })
    })

    it("shows filter empty state when no loans match", () => {
      cy.visit("/loans")
      // A fresh loan has 0 days overdue, so Critical filter should be empty
      cy.contains("button", "Critical (30+ days)", { timeout: 10000 }).click()
      cy.contains("h2", "No loans in this category.", { timeout: 10000 }).should("be.visible")
      cy.contains("No loans match the selected filter. Try a different category.").should("be.visible")
      cy.contains("button", "Show all loans").should("be.visible")
      cy.contains("button", "Show all loans").click()
      cy.get("[data-testid='data-row']", { timeout: 10000 }).should("exist")
    })

    it("shows a no-match state and clears the customer-name search", () => {
      cy.visit("/loans")
      cy.get("input[placeholder='Search by customer name...']").type("No Such Borrower")
      cy.contains("No loans match your search.", { timeout: 10000 }).should("be.visible")

      cy.contains("button", "Clear filters").first().click()
      cy.get("input[placeholder='Search by customer name...']").should("have.value", "")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
    })

    it("composes customer-name search with the selected risk category", () => {
      cy.visit("/loans")
      cy.contains("button", "Early (0-24 days)", { timeout: 10000 }).click()
      cy.get("input[placeholder='Search by customer name...']").type("Test")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)

      cy.contains("button", "Clear filters").click()
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
      cy.contains("Early (0-24 days)").closest("button").should("have.attr", "aria-pressed", "true")
    })

    // Regression: a same-day payment must not flip a brand-new loan to Critical.
    // Pre-fix bug: allocatePayment charged a full 30 days of interest at day 0,
    // booking ~10% of principal as Interest Earned. The watchlist then divided
    // that figure by the daily rate and reported 30 days overdue. After the fix,
    // pro-rata interest at day 0 is zero, so the entire payment reduces principal
    // and daysOverdue stays at 0.
    it("same-day payment on a new loan does not turn it Critical", () => {
      cy.visit("/loans")
      cy.get("[data-testid='data-row']", { timeout: 10000 })
        .first()
        .click()
      cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-zA-Z0-9-]+$/)
      cy.contains("Record Payment", { timeout: 10000 }).click()
      cy.get("#amount", { timeout: 10000 }).type("100000")
      cy.contains("button", "Record Payment").click()
      cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-zA-Z0-9-]+$/)

      cy.visit("/loans")
      cy.get("[data-testid='data-row']", { timeout: 10000 }).should("exist")
      // The loan must not appear under the Critical (30+) filter.
      cy.contains("Critical (30+ days)", { timeout: 10000 }).closest("button").click()
      cy.contains("h2", "No loans in this category.", { timeout: 10000 }).should("be.visible")
      cy.contains("button", "Show all loans").click()
      // Principal Balance reduced by the full payment (interest = 0 at day 0).
      cy.contains("[data-testid='data-row']", "Test Borrower").within(() => {
        cy.contains("900,000").should("exist")
      })
    })
  })

  context("navigation", () => {
    beforeEach(() => {
      seedCustomerAndLoan("Nav Test Borrower", "0700000002", "500000")
    })

    it("row click navigates to loan detail", () => {
      cy.visit("/loans")
      cy.get("[data-testid='data-row']", { timeout: 10000 }).first().click()
      cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-zA-Z0-9-]+$/)
    })

    it("customer link from loan detail navigates to customer profile", () => {
      cy.visit("/loans")
      cy.contains("[data-testid='data-row']", "Nav Test Borrower", { timeout: 10000 }).click()
      cy.url({ timeout: 10000 }).should("match", /\/loans\/[a-zA-Z0-9-]+$/)
      cy.get("a[href^='/customers/']", { timeout: 10000 }).first().click()
      cy.url({ timeout: 30000 }).should("match", /\/customers\//)
    })

    it("/watchlist returns 404 after deletion", () => {
      cy.request({ url: "/watchlist", failOnStatusCode: false })
        .its("status")
        .should("eq", 404)
    })

    it("sidebar shows Loans but not Watchlist", () => {
      cy.viewport(1280, 800)
      cy.visit("/loans")
      cy.get("[data-testid='sidebar-nav']", { timeout: 10000 }).should("be.visible")
      cy.get("[data-testid='sidebar-nav']").contains("Loans").should("be.visible")
      cy.get("[data-testid='sidebar-nav']").contains("Watchlist").should("not.exist")
    })
  })

  context("customer-name filter with multiple loans", () => {
    beforeEach(() => {
      seedCustomerAndLoan("Alice Filter Borrower", "0700000011", "500000").then(({ loanId }) =>
        cy.task("db:setLoanStartDate", {
          loanId,
          startDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        })
      )
      seedCustomerAndLoan("Bob Filter Borrower", "0700000012", "600000").then(({ loanId }) =>
        cy.task("db:setLoanStartDate", {
          loanId,
          startDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        })
      )
    })

    it("shows only the matching customer loan", () => {
      cy.visit("/loans")
      cy.contains("Alice Filter Borrower", { timeout: 10000 }).should("be.visible")
      cy.contains("Bob Filter Borrower").should("be.visible")

      cy.get("input[placeholder='Search by customer name...']").type("alice")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
      cy.get("[data-testid='data-row']").filter(":visible").should("contain", "Alice Filter Borrower")
      cy.get("[data-testid='data-row']").filter(":visible").should("not.contain", "Bob Filter Borrower")
    })

    it("uses the filtered rows in the print document", () => {
      cy.visit("/loans", { onBeforeLoad: suppressIframePrint })
      cy.get("input[placeholder='Search by customer name...']").type("Alice")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length", 1)
      cy.get("[data-testid='data-row']").filter(":visible").should("contain", "Alice Filter Borrower")
      cy.contains("button", "Print").click()

      getLoansPrintDocument().then((doc) => {
        const bodyText = doc.body.textContent ?? ""
        expect(bodyText).to.contain("Alice Filter Borrower")
        expect(bodyText).not.to.contain("Bob Filter Borrower")
        expect([...doc.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim())).to.deep.equal([
          "No.", "Customer Name", "Contact", "Principal Amount", "Principal Balance",
          "Accrued Interest", "Total Due", "Days Overdue", "Last Payment",
        ])
        expect([...doc.querySelectorAll("thead th")].some((cell) => cell.textContent?.includes("(UGX)"))).to.equal(false)
        expect(doc.querySelectorAll("tbody tr")).to.have.length(1)
        const row = doc.querySelector("tbody tr")!
        expect(row.querySelectorAll("td")).to.have.length(9)
        expect(row.querySelector("td")?.textContent?.trim()).to.equal("1")
      })
    })

    it("prints two loans with numbered rows and aligned currency totals", () => {
      cy.visit("/loans", { onBeforeLoad: suppressIframePrint })
      cy.get("[data-testid='data-row']", { timeout: 10000 }).filter(":visible").should("have.length", 2)
      cy.contains("button", "Print").click()

      getLoansPrintDocument().then((doc) => {
        const headers = [...doc.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim())
        expect(headers).to.deep.equal([
          "No.", "Customer Name", "Contact", "Principal Amount", "Principal Balance",
          "Accrued Interest", "Total Due", "Days Overdue", "Last Payment",
        ])
        expect(headers.every((header) => !header?.includes("(UGX)"))).to.equal(true)
        const numericAmount = (value: string | null) =>
          Number((value ?? "").replace(/[^\d.-]/g, ""))
        const rows = [...doc.querySelectorAll("tbody tr")]
        expect(rows).to.have.length(2)
        rows.forEach((row, index) => {
          const cells = [...row.querySelectorAll("td")]
          expect(cells).to.have.length(9)
          expect(cells[0].textContent?.trim()).to.equal(String(index + 1))
          for (const amountColumn of [3, 4, 5, 6]) {
            expect(cells[amountColumn].textContent?.trim()).not.to.match(/^UGX\s/)
            expect(cells[amountColumn].textContent?.trim()).to.match(/[\d,]/)
          }
          const interest = numericAmount(cells[5].textContent)
          const totalDue = numericAmount(cells[6].textContent)
          const principalBalance = numericAmount(cells[4].textContent)
          expect(Math.abs(totalDue - (principalBalance + interest))).to.be.at.most(1)
        })
        const footerCells = [...doc.querySelectorAll("tfoot tr td")]
        expect(footerCells).to.have.length(9)
        expect(footerCells[0].textContent?.trim()).to.equal("")
        expect(footerCells[1].textContent?.trim()).to.equal("TOTAL")
        for (const [rowColumn, footerColumn] of [[3, 3], [4, 4], [5, 5], [6, 6]]) {
          const rowSum = rows.reduce(
            (sum, row) => sum + numericAmount(row.querySelectorAll("td")[rowColumn].textContent),
            0,
          )
          expect(
            Math.abs(numericAmount(footerCells[footerColumn].textContent) - rowSum),
          ).to.be.at.most(rows.length)
        }
        for (const amountColumn of [3, 4, 5, 6]) {
          expect(footerCells[amountColumn].textContent?.trim()).not.to.match(/^UGX\s/)
          expect(footerCells[amountColumn].textContent?.trim()).to.match(/[\d,]/)
        }
        expect(rows[0].querySelectorAll("td")[5].textContent).not.to.equal(rows[1].querySelectorAll("td")[5].textContent)
        expect(rows[0].querySelectorAll("td")[6].textContent).not.to.equal(rows[1].querySelectorAll("td")[6].textContent)
        expect(rows[0].querySelectorAll("td")[5].textContent).not.to.equal(rows[0].querySelectorAll("td")[6].textContent)
      })
    })

    it("keeps nine aligned columns when printing an empty category", () => {
      cy.visit("/loans", { onBeforeLoad: suppressIframePrint })
      cy.contains("button", "At Risk (25-29 days)", { timeout: 10000 }).click()
      cy.contains("h2", "No loans in this category.").should("be.visible")
      cy.contains("button", "Print").click()
      getLoansPrintDocument().then((doc) => {
        expect(doc.querySelector("tbody tr td")?.getAttribute("colspan")).to.equal("9")
        expect(doc.querySelectorAll("tfoot tr td")).to.have.length(9)
        expect(doc.querySelectorAll("thead th")).to.have.length(9)
      })
    })
  })

  context("at mobile viewport (390x844)", () => {
    beforeEach(() => {
      cy.viewport(390, 844)
    })

    it("renders card layout at mobile", () => {
      seedCustomerAndLoan("Mobile Borrower", "0700000003", "750000")
      cy.visit("/loans")
      cy.get("[data-slot='table-container']", { timeout: 10000 }).should("not.be.visible")
      cy.get("[data-testid='data-row']").filter(":visible").should("have.length.gte", 1)
    })

    it("shows tab bar at mobile", () => {
      cy.visit("/loans")
      cy.get("[data-testid='bottom-tab-bar']", { timeout: 10000 }).should("exist")
        .and("be.visible")
      cy.get("[data-testid='bottom-tab-dashboard']").should("exist")
      cy.get("[data-testid='bottom-tab-customers']").should("exist")
      cy.get("[data-testid='bottom-tab-payments']").should("exist")
      cy.get("[data-testid='bottom-tab-loans']").should("exist")
        .and("have.attr", "aria-current", "page")
      cy.get("[data-testid='bottom-tab-more']").should("exist")
    })

    it("reveals the customer-name filter from the mobile filter toggle", () => {
      cy.visit("/loans")
      cy.get("[aria-label='Toggle filters']", { timeout: 10000 }).should("be.visible")
      cy.get("[data-slot='filter-panel-content']").should("not.be.visible")
      cy.get("[aria-label='Toggle filters']").click()
      cy.get("input[placeholder='Search by customer name...']").should("be.visible")
    })

    it("keeps selected filter state visible at mobile width", () => {
      seedCustomerAndLoan("Mobile Filter Borrower", "0700000004", "750000")
      cy.visit("/loans")
      cy.contains("Showing: All Loans", { timeout: 10000 }).should("be.visible")
      cy.contains("Critical (30+ days)").closest("button").click()
      cy.contains("Showing: Critical (30+ days)", { timeout: 10000 }).should("be.visible")
      cy.contains("Critical (30+ days)").closest("button")
        .should("be.visible")
        .and("have.attr", "aria-pressed", "true")
    })
  })
})
