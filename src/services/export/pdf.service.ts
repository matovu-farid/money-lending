import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import type { PnlData, BalanceSheetData, PortfolioEntry } from "@/types"

// `jspdf-autotable` attaches `lastAutoTable` to the jsPDF instance at runtime
// to expose layout info (e.g. final Y coordinate) of the most recently drawn
// table. The plugin's typings don't surface this, so model the shape we use.
type JsPDFWithAutoTable = jsPDF & {
  lastAutoTable: { finalY: number }
}

// Transaction type for PDF export
type TransactionRow = {
  id: string
  type: string
  amount: string
  category: string
  description: string | null
  transactionDate: Date
  recordedBy: string
}

const BUSINESS_NAME = "Money Lending Management"

function formatDate(date: Date | string): string {
  const d = new Date(date)
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

export function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return "UGX 0"
  return `UGX ${new Intl.NumberFormat("en-UG", {
    style: "decimal",
    maximumFractionDigits: 0,
  }).format(num)}`
}

function addBrandedHeader(
  doc: jsPDF,
  reportTitle: string,
  period?: string
): void {
  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  doc.text(BUSINESS_NAME, 14, 20)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(12)
  doc.text(reportTitle, 14, 27)

  if (period) {
    doc.setFontSize(10)
    doc.text(period, 14, 34)
  }

  doc.setFontSize(8)
  doc.setTextColor(130, 130, 130)
  doc.text(`Generated: ${formatDate(new Date())}`, 14, period ? 41 : 34)
  doc.setTextColor(0, 0, 0)

  const lineY = period ? 44 : 37
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.5)
  doc.line(14, lineY, doc.internal.pageSize.getWidth() - 14, lineY)
}

function addPageNumbers(doc: jsPDF): void {
  const totalPages = doc.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(130, 130, 130)
    doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 8, {
      align: "center",
    })
    doc.setTextColor(0, 0, 0)
  }
}

export function generatePortfolioPdf(data: PortfolioEntry[]): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })

  addBrandedHeader(doc, "Loan Portfolio Report")

  const startY = 50

  autoTable(doc, {
    startY,
    head: [
      [
        "Customer",
        "Loan Amount",
        "Outstanding",
        "Interest Accrued",
        "Days Overdue",
        "Status",
        "Risk",
      ],
    ],
    body: data.map((entry) => [
      entry.customerName,
      formatUGX(entry.principalAmount),
      formatUGX(entry.outstandingBalance),
      formatUGX(entry.interestAccrued),
      entry.daysOverdue,
      entry.status,
      entry.riskFlag ? "At Risk" : "",
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 2,
      lineWidth: 0.5,
      lineColor: [200, 200, 200],
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [0, 0, 0],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
  })

  addPageNumbers(doc)

  return Buffer.from(doc.output("arraybuffer"))
}

export function generatePnlPdf(data: PnlData): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  addBrandedHeader(doc, "Profit & Loss Statement", data.period)

  let currentY = 52

  autoTable(doc, {
    startY: currentY,
    head: [["Income Category", "Amount (UGX)"]],
    body: [
      ...data.income.map((row) => [row.category, formatUGX(row.amount)]),
      ["Total Income", formatUGX(data.totalIncome)],
    ],
    styles: {
      fontSize: 10,
      cellPadding: 3,
      lineWidth: 0.3,
      lineColor: [200, 200, 200],
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [0, 0, 0],
      fontStyle: "bold",
    },
    didParseCell: (data) => {
      if (data.row.index === data.table.body.length - 1) {
        data.cell.styles.fontStyle = "bold"
        data.cell.styles.fillColor = [240, 242, 244]
      }
    },
  })

  currentY = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 10

  autoTable(doc, {
    startY: currentY,
    head: [["Expense Category", "Amount (UGX)"]],
    body: [
      ...data.expenses.map((row) => [row.category, formatUGX(row.amount)]),
      ["Total Expenses", formatUGX(data.totalExpenses)],
    ],
    styles: {
      fontSize: 10,
      cellPadding: 3,
      lineWidth: 0.3,
      lineColor: [200, 200, 200],
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [0, 0, 0],
      fontStyle: "bold",
    },
    didParseCell: (data) => {
      if (data.row.index === data.table.body.length - 1) {
        data.cell.styles.fontStyle = "bold"
        data.cell.styles.fillColor = [240, 242, 244]
      }
    },
  })

  currentY = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 10

  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.text("Net Profit:", 14, currentY)
  doc.text(formatUGX(data.netProfit), doc.internal.pageSize.getWidth() - 14, currentY, {
    align: "right",
  })

  addPageNumbers(doc)

  return Buffer.from(doc.output("arraybuffer"))
}

export function generateBalanceSheetPdf(data: BalanceSheetData): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  addBrandedHeader(doc, "Balance Sheet", `As of: ${data.asOf}`)

  let currentY = 52

  autoTable(doc, {
    startY: currentY,
    head: [["Assets", "Amount (UGX)"]],
    body: [
      ["Cash on Hand", formatUGX(data.assets.cashBalance)],
      ["Bank", formatUGX(data.assets.bankBalance)],
      ["Strong Room", formatUGX(data.assets.strongRoomBalance)],
      ["Loans Outstanding", formatUGX(data.assets.totalLoansOutstanding)],
      ...(parseFloat(data.assets.interestReceivable) > 0
        ? [["Interest Receivable", formatUGX(data.assets.interestReceivable)]]
        : []),
      ...(parseFloat(data.assets.seizedCollateralValue) > 0
        ? [["Seized Collateral", formatUGX(data.assets.seizedCollateralValue)]]
        : []),
      [{ content: "Total Assets", styles: { fontStyle: "bold" as const } }, { content: formatUGX(data.assets.totalAssets), styles: { fontStyle: "bold" as const } }],
    ],
    styles: { fontSize: 10, cellPadding: 3, lineWidth: 0.3, lineColor: [200, 200, 200] },
    headStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: "bold" },
  })

  currentY = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 8

  autoTable(doc, {
    startY: currentY,
    head: [["Liabilities", "Amount (UGX)"]],
    body: [
      ["Total Creditor Balances", formatUGX(data.liabilities.totalCreditorBalances)],
      ...(parseFloat(data.liabilities.interestPayable ?? "0") > 0
        ? [["Interest Payable", formatUGX(data.liabilities.interestPayable!)]]
        : []),
    ],
    styles: { fontSize: 10, cellPadding: 3, lineWidth: 0.3, lineColor: [200, 200, 200] },
    headStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: "bold" },
  })

  currentY = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 8

  const liabPlusEquity =
    parseFloat(data.liabilities.totalCreditorBalances) +
    parseFloat(data.liabilities.interestPayable ?? "0") +
    parseFloat(data.equity.totalEquity)

  autoTable(doc, {
    startY: currentY,
    head: [["Equity", "Amount (UGX)"]],
    body: [
      ["Share Capital", formatUGX(data.equity.shareCapital)],
      ["Retained Earnings", formatUGX(data.equity.retainedEarnings)],
      ["Total Equity", formatUGX(data.equity.totalEquity)],
    ],
    styles: { fontSize: 10, cellPadding: 3, lineWidth: 0.3, lineColor: [200, 200, 200] },
    headStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: "bold" },
    didParseCell: (cellData) => {
      if (cellData.row.index === 2) {
        cellData.cell.styles.fontStyle = "bold"
        cellData.cell.styles.fillColor = [240, 242, 244]
      }
    },
  })

  currentY = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 8

  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.text("Total Liabilities + Equity:", 14, currentY)
  doc.text(
    formatUGX(String(liabPlusEquity)),
    doc.internal.pageSize.getWidth() - 14,
    currentY,
    { align: "right" }
  )

  addPageNumbers(doc)

  return Buffer.from(doc.output("arraybuffer"))
}

export function generateTransactionsPdf(
  data: TransactionRow[],
  categories: Map<string, string>
): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })

  addBrandedHeader(doc, "Transaction Log")

  autoTable(doc, {
    startY: 50,
    head: [["Date", "Type", "Category", "Description", "Amount (UGX)", "Recorded By"]],
    body: data.map((tx) => [
      formatDate(tx.transactionDate),
      tx.type,
      categories.get(tx.category) ?? tx.category,
      tx.description ?? "",
      formatUGX(tx.amount),
      tx.recordedBy,
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 2,
      lineWidth: 0.3,
      lineColor: [200, 200, 200],
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [0, 0, 0],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
  })

  addPageNumbers(doc)

  return Buffer.from(doc.output("arraybuffer"))
}
