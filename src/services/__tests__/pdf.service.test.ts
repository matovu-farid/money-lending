import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PnlData, BalanceSheetData, PortfolioEntry } from "@/types"

// Track calls to jsPDF and autoTable for assertions
let docMethods: Record<string, ReturnType<typeof vi.fn>>
let autoTableCalls: any[] = []

function createMockDoc() {
  docMethods = {
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    text: vi.fn(),
    setTextColor: vi.fn(),
    setDrawColor: vi.fn(),
    setLineWidth: vi.fn(),
    line: vi.fn(),
    getNumberOfPages: vi.fn().mockReturnValue(1),
    setPage: vi.fn(),
    output: vi.fn().mockReturnValue(new ArrayBuffer(64)),
  }

  const doc = {
    ...docMethods,
    internal: {
      pageSize: {
        getWidth: () => 297,
        getHeight: () => 210,
      },
    },
    lastAutoTable: { finalY: 100 },
  }
  return doc
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDocInstance: ReturnType<typeof createMockDoc> & Record<string, any>

const MockJsPDF = vi.fn(function (this: any) {
  mockDocInstance = createMockDoc()
  Object.assign(this, mockDocInstance)
  return mockDocInstance
}) as any
MockJsPDF.prototype = {}

vi.mock("jspdf", () => ({
  jsPDF: MockJsPDF,
}))

vi.mock("jspdf-autotable", () => ({
  default: vi.fn((_doc: any, options: any) => {
    autoTableCalls.push(options)
  }),
}))

vi.mock("@/lib/utils", () => ({
  formatDate: (d: Date | string) => {
    const date = typeof d === "string" ? new Date(d) : d
    return date.toISOString().slice(0, 10)
  },
}))

// --- Test data factories ---

function makePortfolioEntry(overrides: Partial<PortfolioEntry> = {}): PortfolioEntry {
  return {
    loanId: "loan-1",
    customerName: "John Doe",
    principalAmount: "500000.00",
    outstandingBalance: "350000.00",
    interestAccrued: "50000.00",
    daysOverdue: "15",
    status: "active",
    riskFlag: false,
    ...overrides,
  }
}

function makePnlData(overrides: Partial<PnlData> = {}): PnlData {
  return {
    period: "March 2026",
    income: [
      { category: "Interest Income", amount: "200000.00" },
      { category: "Fees", amount: "30000.00" },
    ],
    totalIncome: "230000.00",
    expenses: [
      { category: "Salaries", amount: "80000.00" },
      { category: "Rent", amount: "40000.00" },
    ],
    totalExpenses: "120000.00",
    netProfit: "110000.00",
    ...overrides,
  }
}

function makeBalanceSheetData(overrides: Partial<BalanceSheetData> = {}): BalanceSheetData {
  return {
    asOf: "2026-03-23",
    assets: { totalLoansOutstanding: "5000000.00" },
    liabilities: { totalCreditorBalances: "2000000.00" },
    equity: {
      shareCapital: "1000000.00",
      retainedEarnings: "2000000.00",
      totalEquity: "3000000.00",
    },
    ...overrides,
  }
}

// --- Tests ---

describe("PDF Export Service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    autoTableCalls = []
  })

  describe("formatUGX", () => {
    it("formats numeric string with UGX prefix", async () => {
      const { formatUGX } = await import("@/services/export/pdf.service")

      expect(formatUGX("500000")).toBe("UGX 500,000")
      expect(formatUGX("1234567.89")).toBe("UGX 1,234,568")
    })

    it("returns 'UGX 0' for NaN input", async () => {
      const { formatUGX } = await import("@/services/export/pdf.service")

      expect(formatUGX("not-a-number")).toBe("UGX 0")
      expect(formatUGX("")).toBe("UGX 0")
    })

    it("handles zero", async () => {
      const { formatUGX } = await import("@/services/export/pdf.service")

      expect(formatUGX("0")).toBe("UGX 0")
      expect(formatUGX("0.00")).toBe("UGX 0")
    })

    it("handles negative values", async () => {
      const { formatUGX } = await import("@/services/export/pdf.service")

      const result = formatUGX("-50000")
      expect(result).toContain("50,000")
    })
  })

  describe("generatePortfolioPdf", () => {
    it("returns a Buffer", async () => {
      const { generatePortfolioPdf } = await import("@/services/export/pdf.service")
      const result = generatePortfolioPdf([makePortfolioEntry()])

      expect(result).toBeInstanceOf(Buffer)
    })

    it("creates a landscape A4 document", async () => {
      const { jsPDF } = await import("jspdf")
      const { generatePortfolioPdf } = await import("@/services/export/pdf.service")
      generatePortfolioPdf([makePortfolioEntry()])

      expect(jsPDF).toHaveBeenCalledWith({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      })
    })

    it("calls autoTable with correct headers", async () => {
      const { generatePortfolioPdf } = await import("@/services/export/pdf.service")
      generatePortfolioPdf([makePortfolioEntry()])

      expect(autoTableCalls).toHaveLength(1)
      expect(autoTableCalls[0].head[0]).toEqual([
        "Customer",
        "Loan Amount",
        "Outstanding",
        "Interest Accrued",
        "Days Overdue",
        "Status",
        "Risk",
      ])
    })

    it("maps data entries to table body rows", async () => {
      const { generatePortfolioPdf } = await import("@/services/export/pdf.service")
      const entries = [
        makePortfolioEntry({ customerName: "Alice", riskFlag: true }),
        makePortfolioEntry({ customerName: "Bob", riskFlag: false }),
      ]
      generatePortfolioPdf(entries)

      expect(autoTableCalls[0].body).toHaveLength(2)
      expect(autoTableCalls[0].body[0][0]).toBe("Alice")
      expect(autoTableCalls[0].body[0][6]).toBe("At Risk")
      expect(autoTableCalls[0].body[1][0]).toBe("Bob")
      expect(autoTableCalls[0].body[1][6]).toBe("")
    })

    it("handles empty data array", async () => {
      const { generatePortfolioPdf } = await import("@/services/export/pdf.service")
      const result = generatePortfolioPdf([])

      expect(result).toBeInstanceOf(Buffer)
      expect(autoTableCalls[0].body).toHaveLength(0)
    })

    it("formats amounts using UGX formatter", async () => {
      const { generatePortfolioPdf } = await import("@/services/export/pdf.service")
      generatePortfolioPdf([makePortfolioEntry({ principalAmount: "1000000.00" })])

      const firstRow = autoTableCalls[0].body[0]
      expect(firstRow[1]).toContain("UGX")
      expect(firstRow[1]).toContain("1,000,000")
    })

    it("adds page numbers", async () => {
      const { generatePortfolioPdf } = await import("@/services/export/pdf.service")
      generatePortfolioPdf([makePortfolioEntry()])

      // doc.getNumberOfPages should have been called
      expect(mockDocInstance.getNumberOfPages).toHaveBeenCalled()
    })
  })

  describe("generatePnlPdf", () => {
    it("returns a Buffer", async () => {
      const { generatePnlPdf } = await import("@/services/export/pdf.service")
      const result = generatePnlPdf(makePnlData())

      expect(result).toBeInstanceOf(Buffer)
    })

    it("creates a portrait A4 document", async () => {
      const { jsPDF } = await import("jspdf")
      const { generatePnlPdf } = await import("@/services/export/pdf.service")
      generatePnlPdf(makePnlData())

      expect(jsPDF).toHaveBeenCalledWith({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      })
    })

    it("generates two autoTable calls (income + expenses)", async () => {
      const { generatePnlPdf } = await import("@/services/export/pdf.service")
      generatePnlPdf(makePnlData())

      expect(autoTableCalls).toHaveLength(2)
    })

    it("income table includes rows plus total", async () => {
      const { generatePnlPdf } = await import("@/services/export/pdf.service")
      const data = makePnlData()
      generatePnlPdf(data)

      const incomeTable = autoTableCalls[0]
      expect(incomeTable.head[0]).toEqual(["Income Category", "Amount (UGX)"])
      // 2 income rows + 1 total row
      expect(incomeTable.body).toHaveLength(3)
      // Last row is Total Income
      expect(incomeTable.body[2][0]).toBe("Total Income")
    })

    it("expense table includes rows plus total", async () => {
      const { generatePnlPdf } = await import("@/services/export/pdf.service")
      const data = makePnlData()
      generatePnlPdf(data)

      const expenseTable = autoTableCalls[1]
      expect(expenseTable.head[0]).toEqual(["Expense Category", "Amount (UGX)"])
      // 2 expense rows + 1 total row
      expect(expenseTable.body).toHaveLength(3)
      expect(expenseTable.body[2][0]).toBe("Total Expenses")
    })

    it("renders net profit text on the document", async () => {
      const { generatePnlPdf } = await import("@/services/export/pdf.service")
      generatePnlPdf(makePnlData({ netProfit: "110000.00" }))

      expect(mockDocInstance.text).toHaveBeenCalledWith(
        "Net Profit:",
        14,
        expect.any(Number)
      )
    })

    it("handles empty income and expenses", async () => {
      const { generatePnlPdf } = await import("@/services/export/pdf.service")
      const data = makePnlData({
        income: [],
        expenses: [],
        totalIncome: "0",
        totalExpenses: "0",
        netProfit: "0",
      })
      const result = generatePnlPdf(data)

      expect(result).toBeInstanceOf(Buffer)
      // Income table: 0 data rows + 1 total = 1
      expect(autoTableCalls[0].body).toHaveLength(1)
      // Expense table: 0 data rows + 1 total = 1
      expect(autoTableCalls[1].body).toHaveLength(1)
    })
  })

  describe("generateBalanceSheetPdf", () => {
    it("returns a Buffer", async () => {
      const { generateBalanceSheetPdf } = await import("@/services/export/pdf.service")
      const result = generateBalanceSheetPdf(makeBalanceSheetData())

      expect(result).toBeInstanceOf(Buffer)
    })

    it("generates three autoTable calls (assets, liabilities, equity)", async () => {
      const { generateBalanceSheetPdf } = await import("@/services/export/pdf.service")
      generateBalanceSheetPdf(makeBalanceSheetData())

      expect(autoTableCalls).toHaveLength(3)
    })

    it("assets table has correct structure", async () => {
      const { generateBalanceSheetPdf } = await import("@/services/export/pdf.service")
      generateBalanceSheetPdf(makeBalanceSheetData())

      const assetsTable = autoTableCalls[0]
      expect(assetsTable.head[0]).toEqual(["Assets", "Amount (UGX)"])
      expect(assetsTable.body).toHaveLength(1)
      expect(assetsTable.body[0][0]).toBe("Total Loans Outstanding")
    })

    it("liabilities table has correct structure", async () => {
      const { generateBalanceSheetPdf } = await import("@/services/export/pdf.service")
      generateBalanceSheetPdf(makeBalanceSheetData())

      const liabTable = autoTableCalls[1]
      expect(liabTable.head[0]).toEqual(["Liabilities", "Amount (UGX)"])
      expect(liabTable.body).toHaveLength(1)
      expect(liabTable.body[0][0]).toBe("Total Creditor Balances")
    })

    it("equity table includes share capital, retained earnings, and total", async () => {
      const { generateBalanceSheetPdf } = await import("@/services/export/pdf.service")
      generateBalanceSheetPdf(makeBalanceSheetData())

      const equityTable = autoTableCalls[2]
      expect(equityTable.head[0]).toEqual(["Equity", "Amount (UGX)"])
      expect(equityTable.body).toHaveLength(3)
      expect(equityTable.body[0][0]).toBe("Share Capital")
      expect(equityTable.body[1][0]).toBe("Retained Earnings")
      expect(equityTable.body[2][0]).toBe("Total Equity")
    })

    it("renders total liabilities + equity text", async () => {
      const { generateBalanceSheetPdf } = await import("@/services/export/pdf.service")
      generateBalanceSheetPdf(makeBalanceSheetData())

      expect(mockDocInstance.text).toHaveBeenCalledWith(
        "Total Liabilities + Equity:",
        14,
        expect.any(Number)
      )
    })

    it("calculates correct total for liabilities + equity", async () => {
      const { generateBalanceSheetPdf } = await import("@/services/export/pdf.service")
      const data = makeBalanceSheetData({
        liabilities: { totalCreditorBalances: "1000000.00" },
        equity: {
          shareCapital: "500000.00",
          retainedEarnings: "500000.00",
          totalEquity: "1000000.00",
        },
      })
      generateBalanceSheetPdf(data)

      // The total text should be "UGX 2,000,000" (1M liabilities + 1M equity)
      const textCalls = mockDocInstance.text.mock.calls
      const totalCall = textCalls.find(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("2,000,000")
      )
      expect(totalCall).toBeDefined()
    })
  })

  describe("generateTransactionsPdf", () => {
    it("returns a Buffer", async () => {
      const { generateTransactionsPdf } = await import("@/services/export/pdf.service")
      const result = generateTransactionsPdf([], new Map())

      expect(result).toBeInstanceOf(Buffer)
    })

    it("creates a landscape A4 document", async () => {
      const { jsPDF } = await import("jspdf")
      const { generateTransactionsPdf } = await import("@/services/export/pdf.service")
      generateTransactionsPdf([], new Map())

      expect(jsPDF).toHaveBeenCalledWith({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      })
    })

    it("calls autoTable with 6 column headers", async () => {
      const { generateTransactionsPdf } = await import("@/services/export/pdf.service")
      generateTransactionsPdf([], new Map())

      expect(autoTableCalls).toHaveLength(1)
      expect(autoTableCalls[0].head[0]).toEqual([
        "Date",
        "Type",
        "Category",
        "Description",
        "Amount (UGX)",
        "Recorded By",
      ])
    })

    it("maps category names using the provided map", async () => {
      const { generateTransactionsPdf } = await import("@/services/export/pdf.service")
      const tx = {
        id: "tx-1",
        type: "credit",
        amount: "100000.00",
        categoryName: "cat-1",
        description: "Test transaction",
        transactionDate: new Date("2026-03-20"),
        recordedBy: "admin",
      }
      const categories = new Map([["cat-1", "Interest Income"]])
      generateTransactionsPdf([tx], categories)

      expect(autoTableCalls[0].body[0][2]).toBe("Interest Income")
    })

    it("falls back to raw categoryName if not in map", async () => {
      const { generateTransactionsPdf } = await import("@/services/export/pdf.service")
      const tx = {
        id: "tx-1",
        type: "debit",
        amount: "50000.00",
        categoryName: "unknown-cat",
        description: null,
        transactionDate: new Date("2026-03-20"),
        recordedBy: "admin",
      }
      generateTransactionsPdf([tx], new Map())

      expect(autoTableCalls[0].body[0][2]).toBe("unknown-cat")
    })

    it("uses empty string for null description", async () => {
      const { generateTransactionsPdf } = await import("@/services/export/pdf.service")
      const tx = {
        id: "tx-1",
        type: "credit",
        amount: "100000.00",
        categoryName: "cat-1",
        description: null,
        transactionDate: new Date("2026-03-20"),
        recordedBy: "admin",
      }
      generateTransactionsPdf([tx], new Map())

      expect(autoTableCalls[0].body[0][3]).toBe("")
    })

    it("handles empty transaction array", async () => {
      const { generateTransactionsPdf } = await import("@/services/export/pdf.service")
      const result = generateTransactionsPdf([], new Map())

      expect(result).toBeInstanceOf(Buffer)
      expect(autoTableCalls[0].body).toHaveLength(0)
    })

    it("formats amounts with UGX prefix", async () => {
      const { generateTransactionsPdf } = await import("@/services/export/pdf.service")
      const tx = {
        id: "tx-1",
        type: "credit",
        amount: "250000.00",
        categoryName: "cat-1",
        description: "Test",
        transactionDate: new Date("2026-03-20"),
        recordedBy: "admin",
      }
      generateTransactionsPdf([tx], new Map())

      expect(autoTableCalls[0].body[0][4]).toContain("UGX")
      expect(autoTableCalls[0].body[0][4]).toContain("250,000")
    })
  })
})
