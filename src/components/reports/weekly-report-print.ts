import BigNumber from "bignumber.js"
import { parseWeeklyReportPeriod } from "@/lib/weekly-report-period"
import { formatCurrency } from "@/lib/utils"

export type WeeklyLoanPrintRow = {
  customerName: string
  contactNumber: string | null
  principalAmount: string
  principalBalance: string
  totalDue: string
  accruedInterest: string
  daysOverdue: number
  lastPaymentDate: string | null
}

export type WeeklyPaymentPrintRow = {
  customerName: string
  paymentDate: string
  amount: string
  interestPortion: string
  principalPortion: string
  principalBalanceAfter: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!)
}

function date(value: string | null): string {
  if (!value) return "No payments"
  return new Intl.DateTimeFormat("en-UG", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Kampala",
  }).format(new Date(value))
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala",
  }).format(new Date(value))
}

function weekLabel(week: string): string {
  const { endLocalDate } = parseWeeklyReportPeriod(week)
  const format = (value: string) => new Intl.DateTimeFormat("en-UG", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
  return `${format(week)} – ${format(endLocalDate)}`
}

const styles = `@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; } body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 4px; } .meta { color: #555; font-size: 10pt; margin-bottom: 12px; }
.note { color: #555; font-size: 9pt; margin: 0 0 10px; } table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #1f2937; color: #fff; font-weight: 600; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tbody tr:nth-child(even) { background: #f7f7f9; } tfoot td { background: #1f2937; color: #fff; font-weight: 700; }`;

function documentHtml(title: string, week: string, calculatedAt: string, count: number, table: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>
<h1>${escapeHtml(title)}</h1><div class="meta">Week: ${escapeHtml(weekLabel(week))} · As of: ${escapeHtml(dateTime(calculatedAt))} · ${count} ${count === 1 ? "record" : "records"}</div>
${table}</body></html>`
}

export function buildWeeklyLoansPrintHtml(week: string, calculatedAt: string, rows: WeeklyLoanPrintRow[]): string {
  const totals = rows.reduce((sum, row) => ({
    principal: sum.principal.plus(row.principalAmount),
    balance: sum.balance.plus(row.principalBalance),
    due: sum.due.plus(row.totalDue),
    interest: sum.interest.plus(row.accruedInterest),
  }), { principal: new BigNumber(0), balance: new BigNumber(0), due: new BigNumber(0), interest: new BigNumber(0) })
  const body = rows.map((row) => `<tr><td>${escapeHtml(row.customerName)}</td><td>${escapeHtml(row.contactNumber ?? "")}</td>
<td class="num">${formatCurrency(row.principalAmount)}</td><td class="num">${formatCurrency(row.principalBalance)}</td>
<td class="num">${formatCurrency(row.totalDue)}</td><td class="num">${formatCurrency(row.accruedInterest)}</td>
<td class="num">${row.daysOverdue}</td><td>${escapeHtml(date(row.lastPaymentDate))}</td></tr>`).join("")
  return documentHtml("Kaks Credit — Weekly Loans Report", week, calculatedAt, rows.length,
    `<p class="note">Balances and interest are current as of the snapshot time shown above.</p><table><thead><tr>
<th>Customer Name</th><th>Contact</th><th class="num">Principal Amount (UGX)</th><th class="num">Principal Balance (UGX)</th>
<th class="num">Total Due (UGX)</th><th class="num">Accrued Interest (UGX)</th><th class="num">Days Overdue</th><th>Last Payment</th></tr></thead>
<tbody>${body || '<tr><td colspan="8" style="text-align:center;color:#666;padding:24px;">No loans issued this week</td></tr>'}</tbody>
<tfoot><tr><td>TOTAL</td><td></td><td class="num">${formatCurrency(totals.principal.toFixed(2))}</td><td class="num">${formatCurrency(totals.balance.toFixed(2))}</td>
<td class="num">${formatCurrency(totals.due.toFixed(2))}</td><td class="num">${formatCurrency(totals.interest.toFixed(2))}</td><td></td><td>${rows.length} ${rows.length === 1 ? "loan" : "loans"}</td></tr></tfoot></table>`)
}

export function buildWeeklyPaymentsPrintHtml(week: string, calculatedAt: string, rows: WeeklyPaymentPrintRow[]): string {
  const totals = rows.reduce((sum, row) => ({
    amount: sum.amount.plus(row.amount),
    interest: sum.interest.plus(row.interestPortion),
    principal: sum.principal.plus(row.principalPortion),
  }), { amount: new BigNumber(0), interest: new BigNumber(0), principal: new BigNumber(0) })
  const body = rows.map((row) => `<tr><td>${escapeHtml(row.customerName)}</td><td>${escapeHtml(dateTime(row.paymentDate))}</td>
<td class="num">${formatCurrency(row.amount)}</td><td class="num">${formatCurrency(row.interestPortion)}</td>
<td class="num">${formatCurrency(row.principalPortion)}</td><td class="num">${formatCurrency(row.principalBalanceAfter)}</td></tr>`).join("")
  return documentHtml("Kaks Credit — Weekly Payments Report", week, calculatedAt, rows.length,
    `<table><thead><tr><th>Customer</th><th>Date</th><th class="num">Amount (UGX)</th><th class="num">Interest (UGX)</th>
<th class="num">Principal (UGX)</th><th class="num">Principal Balance (UGX)</th></tr></thead>
<tbody>${body || '<tr><td colspan="6" style="text-align:center;color:#666;padding:24px;">No payments this week</td></tr>'}</tbody>
<tfoot><tr><td>TOTAL</td><td></td><td class="num">${formatCurrency(totals.amount.toFixed(2))}</td><td class="num">${formatCurrency(totals.interest.toFixed(2))}</td>
<td class="num">${formatCurrency(totals.principal.toFixed(2))}</td><td></td></tr></tfoot></table>`)
}

export function printHtml(html: string): void {
  document.querySelectorAll('iframe[title="Weekly report print preview"]').forEach((previous) => previous.remove())
  const iframe = document.createElement("iframe")
  iframe.title = "Weekly report print preview"
  iframe.style.position = "fixed"
  iframe.style.width = "0"
  iframe.style.height = "0"
  iframe.style.border = "0"
  iframe.style.left = "-10000px"
  iframe.srcdoc = html
  iframe.onload = () => {
    iframe.contentWindow?.addEventListener("afterprint", () => iframe.remove(), { once: true })
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    window.setTimeout(() => iframe.remove(), 120_000)
  }
  document.body.appendChild(iframe)
}
