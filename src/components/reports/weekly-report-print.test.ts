import { describe, expect, it } from "vitest"
import { buildWeeklyLoansPrintHtml, buildWeeklyPaymentsPrintHtml } from "./weekly-report-print"

describe("weekly report print documents", () => {
  it("prints the Loans report's eight columns and escapes customer data", () => {
    const html = buildWeeklyLoansPrintHtml("2026-09-21", "2026-09-22T07:30:00.000Z", [{
      customerName: '<img src=x onerror="alert(1)">', contactNumber: "<script>bad</script>", principalAmount: "100000.10",
      principalBalance: "50000.05", totalDue: "55000.05", accruedInterest: "5000.00", daysOverdue: 2,
      lastPaymentDate: "2026-09-22T00:00:00.000Z",
    }])

    expect(html).toContain("Customer Name</th><th>Contact</th><th class=\"num\">Principal Amount (UGX)</th>")
    expect(html).toMatch(/Principal Balance \(UGX\)<\/th>\s*<th class="num">Total Due \(UGX\)<\/th>/)
    expect(html).toMatch(/Accrued Interest \(UGX\)<\/th><th class="num">Days Overdue<\/th><th>Last Payment/)
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
    expect(html).not.toContain("<img")
    expect(html).toContain("Week: 21 Sept 2026 – 27 Sept 2026")
    expect(html).toContain("As of: 22 Sept 2026, 10:30")
    expect(html).toContain("UGX 100,000")
    expect(html).toContain("1 loan</td>")
  })

  it("prints six payment columns, snapshot time, and empty state", () => {
    const html = buildWeeklyPaymentsPrintHtml("2026-09-21", "2026-09-22T07:30:00.000Z", [{
      customerName: "Test Customer", paymentDate: "2026-09-22T06:00:00.000Z", amount: "1200.00",
      interestPortion: "200.00", principalPortion: "1000.00", principalBalanceAfter: "9000.00",
    }])
    expect(html).toContain("<th>Customer</th><th>Date</th><th class=\"num\">Amount (UGX)</th>")
    expect(html).toMatch(/Interest \(UGX\)<\/th>\s*<th class="num">Principal \(UGX\)<\/th><th class="num">Principal Balance \(UGX\)/)
    expect(html).toContain("UGX 1,200")
    expect(html).toContain("UGX 200")

    expect(buildWeeklyPaymentsPrintHtml("2026-09-21", "2026-09-22T07:30:00.000Z", [])).toContain("No payments this week")
  })
})
