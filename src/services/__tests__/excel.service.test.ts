import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PnlData, BalanceSheetData, PortfolioEntry } from "@/types"

const mockCells: Map<number, Record<string, any>> = new Map()
let addedRows: any[][] = []
let sheetViews: any[] = []
let sheetAutoFilter: any = null
let columnWidths: Map<number, number> = new Map()
let worksheetName = ""

const mockGetCell = (colIndex: number) => {
  if (!mockCells.has(addedRows.length)) {
    mockCells.set(addedRows.length, {})
  }
  const rowCells = mockCells.get(addedRows.length)!
  if (!rowCells[colIndex]) {
    rowCells[colIndex] = { numFmt: undefined, font: undefined, fill: undefined, border: undefined }
  }
  return rowCells[colIndex]
}

const mockEachCell = vi.fn((optionsOrCb: any, maybeCb?: any) => {
  const cb = maybeCb ?? optionsOrCb
  const rowIndex = addedRows.length
  const row = addedRows[rowIndex - 1]
  if (row) {
    row.forEach((_: any, i: number) => {
      cb(mockGetCell(i + 1), i + 1)
    })
  }
})

const createMockRow = (values: any[]) => ({
  values,
  getCell: (idx: number) => mockGetCell(idx),
  eachCell: mockEachCell,
})

const mockAddRow = vi.fn((values: any[]) => {
  addedRows.push(values)
  return createMockRow(values)
})

const mockGetColumn = vi.fn((idx: number) => ({
  get width() { return columnWidths.get(idx) ?? 0 },
  set width(v: number) { columnWidths.set(idx, v) },
}))

const mockWriteBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(64))

const mockWorksheet = {
  addRow: mockAddRow,
  getColumn: mockGetColumn,
  set views(v: any[]) { sheetViews = v },
  get views() { return sheetViews },
  set autoFilter(v: any) { sheetAutoFilter = v },
  get autoFilter() { return sheetAutoFilter },
}

vi.mock("exceljs", () => {
  class MockWorkbook {
    addWorksheet(name: string) {
      worksheetName = name
      return mockWorksheet
    }
    xlsx = { writeBuffer: mockWriteBuffer }
  }
  return {
    default: { Workbook: MockWorkbook },
  }
})

vi.mock("@/lib/utils", () => ({
  formatDate: (d: Date | string) => {
    const date = typeof d === "string" ? new Date(d) : d
    return date.toISOString().slice(0, 10)
  },
}))

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
    assets: { cashBalance: "0.00", bankBalance: "0.00", strongRoomBalance: "0.00", totalLoansOutstanding: "5000000.00", interestReceivable: "0.00", seizedCollateralValue: "0.00", totalAssets: "5000000.00", bankAccountBalances: {} },
    liabilities: { totalCreditorBalances: "2000000.00" },
    equity: {
      shareCapital: "1000000.00",
      retainedEarnings: "2000000.00",
      totalEquity: "3000000.00",
    },
    ...overrides,
  }
}

describe("Excel Export Service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    addedRows = []
    mockCells.clear()
    sheetViews = []
    sheetAutoFilter = null
    columnWidths = new Map()
    worksheetName = ""
  })

  describe("generatePortfolioExcel", () => {
    it("returns a Buffer", async () => {
      const { generatePortfolioExcel } = await import("@/services/export/excel.service")
      const result = await generatePortfolioExcel([makePortfolioEntry()])

      expect(result).toBeInstanceOf(Buffer)
    })

    it("adds header row with 7 columns", async () => {
      const { generatePortfolioExcel } = await import("@/services/export/excel.service")
      await generatePortfolioExcel([makePortfolioEntry()])

      // First addRow call is the header
      expect(mockAddRow).toHaveBeenCalled()
      const headerCall = mockAddRow.mock.calls[0][0]
      expect(headerCall).toHaveLength(7)
      expect(headerCall).toContain("Customer")
      expect(headerCall).toContain("Status")
      expect(headerCall).toContain("Risk")
    })

    it("adds one data row per entry", async () => {
      const { generatePortfolioExcel } = await import("@/services/export/excel.service")
      const entries = [
        makePortfolioEntry({ loanId: "loan-1", customerName: "Alice" }),
        makePortfolioEntry({ loanId: "loan-2", customerName: "Bob" }),
      ]
      await generatePortfolioExcel(entries)

      // 1 header + 2 data rows
      expect(mockAddRow).toHaveBeenCalledTimes(3)
    })

    it("maps riskFlag true to 'At Risk' and false to empty string", async () => {
      const { generatePortfolioExcel } = await import("@/services/export/excel.service")
      const entries = [
        makePortfolioEntry({ riskFlag: true }),
        makePortfolioEntry({ riskFlag: false }),
      ]
      await generatePortfolioExcel(entries)

      // Data rows are calls 1 and 2 (0 is header)
      const atRiskRow = mockAddRow.mock.calls[1][0]
      const safeRow = mockAddRow.mock.calls[2][0]
      expect(atRiskRow[6]).toBe("At Risk")
      expect(safeRow[6]).toBe("")
    })

    it("handles empty data array", async () => {
      const { generatePortfolioExcel } = await import("@/services/export/excel.service")
      const result = await generatePortfolioExcel([])

      expect(result).toBeInstanceOf(Buffer)
      // Only header row, no data rows
      expect(mockAddRow).toHaveBeenCalledTimes(1)
    })

    it("parses numeric strings for amount columns", async () => {
      const { generatePortfolioExcel } = await import("@/services/export/excel.service")
      await generatePortfolioExcel([makePortfolioEntry({ principalAmount: "500000.00" })])

      // Second addRow call is the first data row
      const dataRow = mockAddRow.mock.calls[1][0]
      expect(dataRow[1]).toBe(500000)
      expect(typeof dataRow[1]).toBe("number")
    })

    it("sets frozen pane and auto-filter", async () => {
      const { generatePortfolioExcel } = await import("@/services/export/excel.service")
      await generatePortfolioExcel([makePortfolioEntry()])

      expect(sheetViews).toEqual([{ state: "frozen", ySplit: 1 }])
      expect(sheetAutoFilter).toEqual({
        from: { row: 1, column: 1 },
        to: { row: 1, column: 7 },
      })
    })

    it("sets column widths within bounds", async () => {
      const { generatePortfolioExcel } = await import("@/services/export/excel.service")
      await generatePortfolioExcel([makePortfolioEntry()])

      expect(mockGetColumn).toHaveBeenCalled()
      // All widths should be clamped between 12 and 40
      for (const [, width] of columnWidths) {
        expect(width).toBeGreaterThanOrEqual(12)
        expect(width).toBeLessThanOrEqual(40)
      }
    })
  })

  describe("generatePnlExcel", () => {
    it("returns a Buffer", async () => {
      const { generatePnlExcel } = await import("@/services/export/excel.service")
      const result = await generatePnlExcel(makePnlData())

      expect(result).toBeInstanceOf(Buffer)
    })

    it("includes title row with period", async () => {
      const { generatePnlExcel } = await import("@/services/export/excel.service")
      await generatePnlExcel(makePnlData({ period: "Q1 2026" }))

      const titleRow = mockAddRow.mock.calls[0][0]
      expect(titleRow[0]).toBe("Profit & Loss Statement")
      expect(titleRow[1]).toBe("Q1 2026")
    })

    it("creates income rows, expense rows, and net profit", async () => {
      const { generatePnlExcel } = await import("@/services/export/excel.service")
      const data = makePnlData()
      await generatePnlExcel(data)

      // Should include: title, blank, income header, 2 income rows, total income,
      // blank, expense header, 2 expense rows, total expenses, blank, net profit
      expect(mockAddRow.mock.calls.length).toBeGreaterThanOrEqual(12)
    })

    it("handles empty income and expenses", async () => {
      const { generatePnlExcel } = await import("@/services/export/excel.service")
      const data = makePnlData({
        income: [],
        expenses: [],
        totalIncome: "0",
        totalExpenses: "0",
        netProfit: "0",
      })
      const result = await generatePnlExcel(data)

      expect(result).toBeInstanceOf(Buffer)
    })
  })

  describe("generateBalanceSheetExcel", () => {
    it("returns a Buffer", async () => {
      const { generateBalanceSheetExcel } = await import("@/services/export/excel.service")
      const result = await generateBalanceSheetExcel(makeBalanceSheetData())

      expect(result).toBeInstanceOf(Buffer)
    })

    it("includes title with asOf date", async () => {
      const { generateBalanceSheetExcel } = await import("@/services/export/excel.service")
      await generateBalanceSheetExcel(makeBalanceSheetData({ asOf: "2026-12-31" }))

      const titleRow = mockAddRow.mock.calls[0][0]
      expect(titleRow[0]).toBe("Balance Sheet")
      expect(titleRow[1]).toBe("As of: 2026-12-31")
    })

    it("includes assets, liabilities, and equity sections", async () => {
      const { generateBalanceSheetExcel } = await import("@/services/export/excel.service")
      await generateBalanceSheetExcel(makeBalanceSheetData())

      const allRowLabels = mockAddRow.mock.calls.map((c) => c[0][0]).filter(Boolean)
      expect(allRowLabels).toContain("Assets")
      expect(allRowLabels).toContain("Liabilities")
      expect(allRowLabels).toContain("Equity")
      expect(allRowLabels).toContain("Total Liabilities + Equity")
    })

    it("calculates liabilities + equity total correctly", async () => {
      const { generateBalanceSheetExcel } = await import("@/services/export/excel.service")
      const data = makeBalanceSheetData({
        liabilities: { totalCreditorBalances: "2000000.00" },
        equity: {
          shareCapital: "1000000.00",
          retainedEarnings: "2000000.00",
          totalEquity: "3000000.00",
        },
      })
      await generateBalanceSheetExcel(data)

      // Last addRow call should be the total row
      const lastCall = mockAddRow.mock.calls[mockAddRow.mock.calls.length - 1][0]
      expect(lastCall[0]).toBe("Total Liabilities + Equity")
      expect(lastCall[1]).toBe(5000000) // 2M + 3M
    })
  })

  describe("generateTransactionsExcel", () => {
    it("returns a Buffer", async () => {
      const { generateTransactionsExcel } = await import("@/services/export/excel.service")
      const result = await generateTransactionsExcel([], new Map())

      expect(result).toBeInstanceOf(Buffer)
    })

    it("adds header row with 6 columns", async () => {
      const { generateTransactionsExcel } = await import("@/services/export/excel.service")
      await generateTransactionsExcel([], new Map())

      const headerCall = mockAddRow.mock.calls[0][0]
      expect(headerCall).toHaveLength(6)
      expect(headerCall).toContain("Date")
      expect(headerCall).toContain("Type")
      expect(headerCall).toContain("Amount (UGX)")
    })

    it("maps category names using the provided map", async () => {
      const { generateTransactionsExcel } = await import("@/services/export/excel.service")
      const tx = {
        id: "tx-1",
        type: "credit",
        amount: "100000.00",
        category: "cat-1",
        description: "Test",
        transactionDate: new Date("2026-03-20"),
        recordedBy: "admin",
      }
      const categories = new Map([["cat-1", "Interest Income"]])

      await generateTransactionsExcel([tx], categories)

      const dataRow = mockAddRow.mock.calls[1][0]
      expect(dataRow[2]).toBe("Interest Income")
    })

    it("falls back to raw categoryName if not in map", async () => {
      const { generateTransactionsExcel } = await import("@/services/export/excel.service")
      const tx = {
        id: "tx-1",
        type: "debit",
        amount: "50000.00",
        category: "unknown-cat",
        description: null,
        transactionDate: new Date("2026-03-20"),
        recordedBy: "admin",
      }

      await generateTransactionsExcel([tx], new Map())

      const dataRow = mockAddRow.mock.calls[1][0]
      expect(dataRow[2]).toBe("unknown-cat")
    })

    it("uses empty string for null description", async () => {
      const { generateTransactionsExcel } = await import("@/services/export/excel.service")
      const tx = {
        id: "tx-1",
        type: "credit",
        amount: "100000.00",
        category: "cat-1",
        description: null,
        transactionDate: new Date("2026-03-20"),
        recordedBy: "admin",
      }

      await generateTransactionsExcel([tx], new Map())

      const dataRow = mockAddRow.mock.calls[1][0]
      expect(dataRow[3]).toBe("")
    })

    it("handles empty transaction array", async () => {
      const { generateTransactionsExcel } = await import("@/services/export/excel.service")
      const result = await generateTransactionsExcel([], new Map())

      expect(result).toBeInstanceOf(Buffer)
      // Only header, no data rows
      expect(mockAddRow).toHaveBeenCalledTimes(1)
    })

    it("sets frozen pane and auto-filter for 6 columns", async () => {
      const { generateTransactionsExcel } = await import("@/services/export/excel.service")
      await generateTransactionsExcel([], new Map())

      expect(sheetViews).toEqual([{ state: "frozen", ySplit: 1 }])
      expect(sheetAutoFilter).toEqual({
        from: { row: 1, column: 1 },
        to: { row: 1, column: 6 },
      })
    })
  })
})
