import { describe, expect, it } from "vitest"
import { buildWeeklyLoansPrintHtml, buildWeeklyPaymentsPrintHtml } from "./weekly-report-print"

describe("weekly report print documents", () => {
  it("prints the Loans report's eight columns and escapes customer data", () => {
    const html = buildWeeklyLoansPrintHtml("2026-09-21", "2026-09-22T07:30:00.000Z", [{
      customerName: '<img src=x onerror="alert(1)">', contactNumber: "<script>bad</script>", principalAmount: "100000.10",
      principalBalance: "50000.05", totalDue: "55000.05", accruedInterest: "5000.00", daysOverdue: 2,
      lastPaymentDate: "2026-09-22T00:00:00.000Z",
    }])

    expect(html).toContain("Customer Name</th><th>Contact</th><th class=\"num\">Principal Amount</th>")
    expect(html).toMatch(/Principal Balance<\/th>\s*<th class="num">Accrued Interest<\/th><th class="num">Total Due<\/th>/)
    expect(html).toMatch(/Total Due<\/th><th class="num">Days Overdue<\/th><th>Last Payment/)
    const body = html.split("<tbody>")[1].split("</tbody>")[0]
    const footer = html.split("<tfoot>")[1].split("</tfoot>")[0]
    expect(body).toMatch(/>5,000<\/td><td class="num">55,000<\/td>/)
    expect(footer).toMatch(/>5,000<\/td><td class="num">55,000<\/td>/)
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
    expect(html).not.toContain("<img")
    expect(html).toContain("Week: 21 Sept 2026 – 27 Sept 2026")
    expect(html).toContain("As of: 22 Sept 2026, 10:30")
    expect(body).toContain("100,000")
    expect(footer).toContain("100,000")
    expect(body).not.toContain("UGX")
    expect(footer).not.toContain("UGX")
    expect(html).not.toContain("(UGX)")
    expect(html).toContain("1 loan</td>")
  })

  it("prints six payment columns, snapshot time, and empty state", () => {
    const html = buildWeeklyPaymentsPrintHtml("2026-09-21", "2026-09-22T07:30:00.000Z", [{
      customerName: "Test Customer", paymentDate: "2026-09-22T06:00:00.000Z", amount: "1200.00",
      interestPortion: "200.00", principalPortion: "1000.00", principalBalanceAfter: "9000.00",
    }])
    expect(html).toContain("<th>Customer</th><th>Date</th><th class=\"num\">Amount</th>")
    expect(html).toMatch(/Interest<\/th>\s*<th class="num">Principal<\/th><th class="num">Principal Balance/)
    const body = html.split("<tbody>")[1].split("</tbody>")[0]
    const footer = html.split("<tfoot>")[1].split("</tfoot>")[0]
    expect(body).toContain("1,200")
    expect(body).toContain("200")
    expect(footer).toContain("1,200")
    expect(footer).toContain("200")
    expect(body).not.toContain("UGX")
    expect(footer).not.toContain("UGX")
    expect(html).not.toContain("(UGX)")

    const emptyHtml = buildWeeklyPaymentsPrintHtml("2026-09-21", "2026-09-22T07:30:00.000Z", [])
    expect(emptyHtml).toContain("No payments this week")
    expect(emptyHtml).toContain(">0</td>")
    expect(emptyHtml).not.toContain("(UGX)")
  })
})
