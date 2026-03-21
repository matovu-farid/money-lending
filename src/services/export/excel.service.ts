import ExcelJS from "exceljs"
import type { PnlData, BalanceSheetData, PortfolioEntry } from "@/types"

// Transaction type for Excel export
type TransactionRow = {
  id: string
  type: string
  amount: string
  categoryName: string
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

  // Header row
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

  // Freeze pane & auto-filter
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 7 },
  }

  // Data rows
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

    // Apply UGX number format to amount columns
    row.getCell(2).numFmt = UGX_FORMAT
    row.getCell(3).numFmt = UGX_FORMAT
    row.getCell(4).numFmt = UGX_FORMAT

    applyDataRowStyle(row, idx % 2 === 1)
  })

  setColumnWidths(sheet, [28, 20, 20, 22, 14, 12, 12])

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export async function generatePnlExcel(data: PnlData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(`P&L ${data.period}`)

  // Title rows
  const titleRow = sheet.addRow(["Profit & Loss Statement", data.period])
  titleRow.getCell(1).font = { bold: true, size: 14 }
  titleRow.getCell(2).font = { size: 11 }
  sheet.addRow([]) // blank separator

  // Income section header
  const incomeHeader = sheet.addRow(["Income Category", "Amount (UGX)"])
  applyHeaderStyle(incomeHeader)
  sheet.views = [{ state: "frozen", ySplit: 4 }]

  data.income.forEach((row, idx) => {
    const dataRow = sheet.addRow([row.category, parseFloat(row.amount)])
    dataRow.getCell(2).numFmt = UGX_FORMAT
    applyDataRowStyle(dataRow, idx % 2 === 1)
  })

  // Total Income subtotal row
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

  // Expense section header
  const expenseHeader = sheet.addRow(["Expense Category", "Amount (UGX)"])
  applyHeaderStyle(expenseHeader)

  data.expenses.forEach((row, idx) => {
    const dataRow = sheet.addRow([row.category, parseFloat(row.amount)])
    dataRow.getCell(2).numFmt = UGX_FORMAT
    applyDataRowStyle(dataRow, idx % 2 === 1)
  })

  // Total Expenses subtotal row
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

  // Net Profit row
  const netProfitRow = sheet.addRow(["Net Profit", parseFloat(data.netProfit)])
  netProfitRow.getCell(1).font = { bold: true, size: 12 }
  netProfitRow.getCell(2).font = { bold: true, size: 12 }
  netProfitRow.getCell(2).numFmt = UGX_FORMAT

  setColumnWidths(sheet, [30, 20])

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export async function generateBalanceSheetExcel(
  data: BalanceSheetData
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Balance Sheet")

  // Title
  const titleRow = sheet.addRow(["Balance Sheet", `As of: ${data.asOf}`])
  titleRow.getCell(1).font = { bold: true, size: 14 }
  titleRow.getCell(2).font = { size: 11 }
  sheet.addRow([])

  // Assets section
  const assetsHeader = sheet.addRow(["Assets", "Amount (UGX)"])
  applyHeaderStyle(assetsHeader)

  const assetsRow = sheet.addRow([
    "Total Loans Outstanding",
    parseFloat(data.assets.totalLoansOutstanding),
  ])
  assetsRow.getCell(2).numFmt = UGX_FORMAT
  applyDataRowStyle(assetsRow, false)
  sheet.addRow([])

  // Liabilities section
  const liabHeader = sheet.addRow(["Liabilities", "Amount (UGX)"])
  applyHeaderStyle(liabHeader)

  const liabRow = sheet.addRow([
    "Total Creditor Balances",
    parseFloat(data.liabilities.totalCreditorBalances),
  ])
  liabRow.getCell(2).numFmt = UGX_FORMAT
  applyDataRowStyle(liabRow, false)
  sheet.addRow([])

  // Equity section
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

  // Total Liabilities + Equity
  const liabPlusEquity =
    parseFloat(data.liabilities.totalCreditorBalances) +
    parseFloat(data.equity.totalEquity)
  const totalRow = sheet.addRow(["Total Liabilities + Equity", liabPlusEquity])
  totalRow.getCell(1).font = { bold: true, size: 12 }
  totalRow.getCell(2).font = { bold: true, size: 12 }
  totalRow.getCell(2).numFmt = UGX_FORMAT

  setColumnWidths(sheet, [32, 20])

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export async function generateTransactionsExcel(
  data: TransactionRow[],
  categories: Map<string, string>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Transaction Log")

  // Header
  const headerRow = sheet.addRow([
    "Date",
    "Type",
    "Category",
    "Description",
    "Amount (UGX)",
    "Recorded By",
  ])
  applyHeaderStyle(headerRow)

  // Freeze pane & auto-filter
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 6 },
  }

  // Data rows
  data.forEach((tx, idx) => {
    const row = sheet.addRow([
      formatDateStr(tx.transactionDate),
      tx.type,
      categories.get(tx.categoryName) ?? tx.categoryName,
      tx.description ?? "",
      parseFloat(tx.amount),
      tx.recordedBy,
    ])

    row.getCell(5).numFmt = UGX_FORMAT
    applyDataRowStyle(row, idx % 2 === 1)
  })

  setColumnWidths(sheet, [14, 10, 24, 32, 18, 20])

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
