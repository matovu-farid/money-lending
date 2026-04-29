import ExcelJS from "exceljs"
import type { PnlData, BalanceSheetData, PortfolioEntry, LoanListEntry } from "@/types"

// Transaction type for Excel export
type TransactionRow = {
  id: string
  type: string
  amount: string
  category: string
  description: string | null
  transactionDate: Date
  recordedBy: string
}

const UGX_FORMAT = '"UGX "#,##0.00'

function formatDateStr(date: Date | string): string {
  const d = new Date(date)
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

function applyHeaderStyle(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    }
    cell.font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: 12,
    }
    cell.border = {
      top: { style: "thin", color: { argb: "FFE5E7EB" } },
      left: { style: "thin", color: { argb: "FFE5E7EB" } },
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
      right: { style: "thin", color: { argb: "FFE5E7EB" } },
    }
  })
}

function applyDataRowStyle(row: ExcelJS.Row, isAlternate: boolean): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (isAlternate) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF9FAFB" },
      }
    }
    cell.font = { size: 11 }
    cell.border = {
      top: { style: "thin", color: { argb: "FFE5E7EB" } },
      left: { style: "thin", color: { argb: "FFE5E7EB" } },
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
      right: { style: "thin", color: { argb: "FFE5E7EB" } },
    }
  })
}

function setColumnWidths(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = Math.min(40, Math.max(12, width))
  })
}

export async function generatePortfolioExcel(
  data: PortfolioEntry[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Loan Portfolio")

  const headerRow = sheet.addRow([
    "Customer",
    "Loan Amount (UGX)",
    "Outstanding (UGX)",
    "Interest Accrued (UGX)",
    "Days Overdue",
    "Status",
    "Risk",
  ])
  applyHeaderStyle(headerRow)

  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 7 },
  }

  data.forEach((entry, idx) => {
    const row = sheet.addRow([
      entry.customerName,
      parseFloat(entry.principalAmount),
      parseFloat(entry.outstandingBalance),
      parseFloat(entry.interestAccrued),
      parseInt(entry.daysOverdue),
      entry.status,
      entry.riskFlag ? "At Risk" : "",
    ])

    row.getCell(2).numFmt = UGX_FORMAT
    row.getCell(3).numFmt = UGX_FORMAT
    row.getCell(4).numFmt = UGX_FORMAT

    applyDataRowStyle(row, idx % 2 === 1)
  })

  setColumnWidths(sheet, [28, 20, 20, 22, 14, 12, 12])

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function generatePnlExcel(data: PnlData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(`P&L ${data.period}`)

  const titleRow = sheet.addRow(["Profit & Loss Statement", data.period])
  titleRow.getCell(1).font = { bold: true, size: 14 }
  titleRow.getCell(2).font = { size: 11 }
  sheet.addRow([]) // blank separator

  const incomeHeader = sheet.addRow(["Income Category", "Amount (UGX)"])
  applyHeaderStyle(incomeHeader)
  sheet.views = [{ state: "frozen", ySplit: 4 }]

  data.income.forEach((row, idx) => {
    const dataRow = sheet.addRow([row.category, parseFloat(row.amount)])
    dataRow.getCell(2).numFmt = UGX_FORMAT
    applyDataRowStyle(dataRow, idx % 2 === 1)
  })

  const totalIncomeRow = sheet.addRow([
    "Total Income",
    parseFloat(data.totalIncome),
  ])
  totalIncomeRow.getCell(1).font = { bold: true, size: 11 }
  totalIncomeRow.getCell(2).font = { bold: true, size: 11 }
  totalIncomeRow.getCell(2).numFmt = UGX_FORMAT
  totalIncomeRow.getCell(2).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF0F2F4" },
  }

  sheet.addRow([]) // blank separator

  const expenseHeader = sheet.addRow(["Expense Category", "Amount (UGX)"])
  applyHeaderStyle(expenseHeader)

  data.expenses.forEach((row, idx) => {
    const dataRow = sheet.addRow([row.category, parseFloat(row.amount)])
    dataRow.getCell(2).numFmt = UGX_FORMAT
    applyDataRowStyle(dataRow, idx % 2 === 1)
  })

  const totalExpensesRow = sheet.addRow([
    "Total Expenses",
    parseFloat(data.totalExpenses),
  ])
  totalExpensesRow.getCell(1).font = { bold: true, size: 11 }
  totalExpensesRow.getCell(2).font = { bold: true, size: 11 }
  totalExpensesRow.getCell(2).numFmt = UGX_FORMAT
  totalExpensesRow.getCell(2).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF0F2F4" },
  }

  sheet.addRow([]) // blank separator

  const netProfitRow = sheet.addRow(["Net Profit", parseFloat(data.netProfit)])
  netProfitRow.getCell(1).font = { bold: true, size: 12 }
  netProfitRow.getCell(2).font = { bold: true, size: 12 }
  netProfitRow.getCell(2).numFmt = UGX_FORMAT

  setColumnWidths(sheet, [30, 20])

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function generateBalanceSheetExcel(
  data: BalanceSheetData
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Balance Sheet")

  const titleRow = sheet.addRow(["Balance Sheet", `As of: ${data.asOf}`])
  titleRow.getCell(1).font = { bold: true, size: 14 }
  titleRow.getCell(2).font = { size: 11 }
  sheet.addRow([])

  const assetsHeader = sheet.addRow(["Assets", "Amount (UGX)"])
  applyHeaderStyle(assetsHeader)

  const assetRows = [
    ["Cash on Hand", parseFloat(data.assets.cashBalance)],
    ["Bank", parseFloat(data.assets.bankBalance)],
    ["Strong Room", parseFloat(data.assets.strongRoomBalance)],
    ["Loans Outstanding", parseFloat(data.assets.totalLoansOutstanding)],
  ] as [string, number][]

  if (parseFloat(data.assets.interestReceivable) > 0) {
    assetRows.push(["Interest Receivable", parseFloat(data.assets.interestReceivable)])
  }

  if (parseFloat(data.assets.seizedCollateralValue) > 0) {
    assetRows.push(["Seized Collateral", parseFloat(data.assets.seizedCollateralValue)])
  }

  assetRows.push(["Total Assets", parseFloat(data.assets.totalAssets)])

  for (let i = 0; i < assetRows.length; i++) {
    const row = sheet.addRow(assetRows[i])
    row.getCell(2).numFmt = UGX_FORMAT
    const isTotal = i === assetRows.length - 1
    applyDataRowStyle(row, isTotal)
    if (isTotal) row.font = { bold: true }
  }
  sheet.addRow([])

  const liabHeader = sheet.addRow(["Liabilities", "Amount (UGX)"])
  applyHeaderStyle(liabHeader)

  const liabRow = sheet.addRow([
    "Total Creditor Balances",
    parseFloat(data.liabilities.totalCreditorBalances),
  ])
  liabRow.getCell(2).numFmt = UGX_FORMAT
  applyDataRowStyle(liabRow, false)

  const interestPayableVal = parseFloat(data.liabilities.interestPayable ?? "0")
  if (interestPayableVal > 0) {
    const ipRow = sheet.addRow(["Interest Payable", interestPayableVal])
    ipRow.getCell(2).numFmt = UGX_FORMAT
    applyDataRowStyle(ipRow, true)
  }
  sheet.addRow([])

  const equityHeader = sheet.addRow(["Equity", "Amount (UGX)"])
  applyHeaderStyle(equityHeader)

  const scRow = sheet.addRow(["Share Capital", parseFloat(data.equity.shareCapital)])
  scRow.getCell(2).numFmt = UGX_FORMAT
  applyDataRowStyle(scRow, false)

  const reRow = sheet.addRow(["Retained Earnings", parseFloat(data.equity.retainedEarnings)])
  reRow.getCell(2).numFmt = UGX_FORMAT
  applyDataRowStyle(reRow, true)

  const teRow = sheet.addRow(["Total Equity", parseFloat(data.equity.totalEquity)])
  teRow.getCell(1).font = { bold: true, size: 11 }
  teRow.getCell(2).font = { bold: true, size: 11 }
  teRow.getCell(2).numFmt = UGX_FORMAT
  sheet.addRow([])

  const liabPlusEquity =
    parseFloat(data.liabilities.totalCreditorBalances) +
    parseFloat(data.liabilities.interestPayable ?? "0") +
    parseFloat(data.equity.totalEquity)
  const totalRow = sheet.addRow(["Total Liabilities + Equity", liabPlusEquity])
  totalRow.getCell(1).font = { bold: true, size: 12 }
  totalRow.getCell(2).font = { bold: true, size: 12 }
  totalRow.getCell(2).numFmt = UGX_FORMAT

  setColumnWidths(sheet, [32, 20])

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function generateTransactionsExcel(
  data: TransactionRow[],
  categories: Map<string, string>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Transaction Log")

  const headerRow = sheet.addRow([
    "Date",
    "Type",
    "Category",
    "Description",
    "Amount (UGX)",
    "Recorded By",
  ])
  applyHeaderStyle(headerRow)

  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 6 },
  }

  data.forEach((tx, idx) => {
    const row = sheet.addRow([
      formatDateStr(tx.transactionDate),
      tx.type,
      categories.get(tx.category) ?? tx.category,
      tx.description ?? "",
      parseFloat(tx.amount),
      tx.recordedBy,
    ])

    row.getCell(5).numFmt = UGX_FORMAT
    applyDataRowStyle(row, idx % 2 === 1)
  })

  setColumnWidths(sheet, [14, 10, 24, 32, 18, 20])

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function generateLoansExcel(
  data: LoanListEntry[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Kaks Credit"
  workbook.created = new Date()

  const sheet = workbook.addWorksheet("Active Loans")

  // Title row
  const titleRow = sheet.addRow([
    `Kaks Credit — Active Loans Report`,
    "",
    "",
    "",
    "",
    "",
    "",
    `Generated: ${formatDateStr(new Date())}`,
  ])
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1F2937" } }
  titleRow.getCell(8).font = { size: 11, italic: true, color: { argb: "FF6B7280" } }
  sheet.mergeCells("A1:G1")

  // Blank separator
  sheet.addRow([])

  // Header row
  const headerRow = sheet.addRow([
    "Customer Name",
    "Contact",
    "Principal Amount (UGX)",
    "Principal Balance (UGX)",
    "Total Due (UGX)",
    "Accrued Interest (UGX)",
    "Days Overdue",
    "Last Payment",
  ])
  applyHeaderStyle(headerRow)

  // Freeze panes below header (row 3 is the header, so freeze at row 4)
  sheet.views = [{ state: "frozen", ySplit: 3 }]

  // Auto-filter on the header row
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: 8 },
  }

  let totalPrincipal = 0
  let totalOutstanding = 0
  let totalOwed = 0
  let totalInterest = 0

  // Data rows
  data.forEach((entry, idx) => {
    const principal = parseFloat(entry.principalAmount)
    const outstanding = parseFloat(entry.outstandingBalance)
    const owed = outstanding + parseFloat(entry.unpaidInterest)
    totalPrincipal += principal
    totalOutstanding += outstanding
    totalOwed += owed

    const unpaidInterest = parseFloat(entry.unpaidInterest)
    totalInterest += unpaidInterest

    const row = sheet.addRow([
      entry.customerName,
      entry.customerContact ?? "",
      principal,
      outstanding,
      owed,
      unpaidInterest,
      entry.daysOverdue,
      entry.lastPaymentDate ? formatDateStr(entry.lastPaymentDate) : "No payments",
    ])

    row.getCell(3).numFmt = UGX_FORMAT
    row.getCell(3).alignment = { horizontal: "right" }
    row.getCell(4).numFmt = UGX_FORMAT
    row.getCell(4).alignment = { horizontal: "right" }
    row.getCell(5).numFmt = UGX_FORMAT
    row.getCell(5).alignment = { horizontal: "right" }
    row.getCell(6).numFmt = UGX_FORMAT
    row.getCell(6).alignment = { horizontal: "right" }
    row.getCell(7).alignment = { horizontal: "right" }

    applyDataRowStyle(row, idx % 2 === 1)
  })

  // Blank separator before summary
  sheet.addRow([])

  // Summary row
  const summaryRow = sheet.addRow([
    "TOTAL",
    "",
    totalPrincipal,
    totalOutstanding,
    totalOwed,
    totalInterest,
    "",
    `${data.length} loan${data.length === 1 ? "" : "s"}`,
  ])
  summaryRow.getCell(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } }
  summaryRow.getCell(3).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } }
  summaryRow.getCell(3).numFmt = UGX_FORMAT
  summaryRow.getCell(3).alignment = { horizontal: "right" }
  summaryRow.getCell(4).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } }
  summaryRow.getCell(4).numFmt = UGX_FORMAT
  summaryRow.getCell(4).alignment = { horizontal: "right" }
  summaryRow.getCell(5).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } }
  summaryRow.getCell(5).numFmt = UGX_FORMAT
  summaryRow.getCell(5).alignment = { horizontal: "right" }
  summaryRow.getCell(6).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } }
  summaryRow.getCell(6).numFmt = UGX_FORMAT
  summaryRow.getCell(6).alignment = { horizontal: "right" }
  summaryRow.getCell(8).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } }
  summaryRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    }
    cell.border = {
      top: { style: "thin", color: { argb: "FFE5E7EB" } },
      left: { style: "thin", color: { argb: "FFE5E7EB" } },
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
      right: { style: "thin", color: { argb: "FFE5E7EB" } },
    }
  })

  setColumnWidths(sheet, [30, 18, 24, 24, 24, 16, 14, 18])

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
