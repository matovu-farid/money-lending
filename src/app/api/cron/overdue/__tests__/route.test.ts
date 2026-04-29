import { describe, it, expect, vi, beforeEach } from "vitest"
import { payments } from "@/lib/db/schema/payments"

// ── helpers ────────────────────────────────────────────────────────────
// Recursively extract column names referenced in a Drizzle SQL node.
function findColumnNames(node: any): string[] {
  if (!node) return []
  const cols: string[] = []
  if (node.queryChunks) {
    for (const c of node.queryChunks) {
      if (c.name !== undefined && c.table !== undefined) {
        cols.push(c.name)
      } else {
        cols.push(...findColumnNames(c))
      }
    }
  }
  return cols
}

// ── mocks ──────────────────────────────────────────────────────────────
// Track the where() call on the payments query so we can assert its filters.
let capturedPaymentsWhere: unknown = undefined

vi.mock("@/lib/db", () => {
  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      const chain: Record<string, any> = {}
      chain.select = vi.fn().mockReturnValue(chain)

      chain.from = vi.fn().mockImplementation((table: any) => {
        const innerChain: Record<string, any> = {}

        innerChain.where = vi.fn().mockImplementation((...args: any[]) => {
          // Detect the payments table by checking the table reference
          if (table === payments) {
            capturedPaymentsWhere = args[0]
          }
          const next: Record<string, any> = {}
          next.orderBy = vi.fn().mockImplementation(() => {
            const thenable: Record<string, any> = {}
            thenable.then = (resolve: any) => resolve([])
            return thenable
          })
          next.then = (resolve: any) => resolve([])
          return next
        })

        innerChain.then = (resolve: any) => resolve([])
        return innerChain
      })

      return chain
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    execute: vi.fn().mockResolvedValue([]),
  }
  return { db: mockDb }
})

vi.mock("@/services/ledger-queries.service", () => ({
  getLoanBalancesFromLedger: vi.fn().mockResolvedValue(new Map()),
  getInterestEarnedFromLedger: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("@/lib/interest/overdue", () => ({
  computeLoanOverdueInfo: vi.fn().mockReturnValue({
    daysOverdue: 0,
    dailyRate: "0",
    unpaidInterest: "0",
    penaltyActive: false,
    effectiveRate: "0.10",
  }),
  shouldResetPenaltyWaiver: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/interest/effective-rate", () => ({
  getBaseRate: vi.fn().mockReturnValue("0.10"),
}))

vi.mock("@/lib/interest/engine", () => ({
  formatAmount: vi.fn().mockReturnValue("0"),
}))

// ── helpers ────────────────────────────────────────────────────────────
function buildRequest() {
  return new Request("http://localhost/api/cron/overdue", {
    method: "GET",
    headers: { authorization: "Bearer test-secret" },
  }) as any
}

describe("Overdue cron – payment query filters", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedPaymentsWhere = undefined
    vi.stubEnv("CRON_SECRET", "test-secret")
  })

  it("excludes markedWrong payments from the payments query", async () => {
    // Arrange – make the loans query return one active loan so the
    // payments query actually executes.
    const { db } = await import("@/lib/db")

    const fakeLoan = {
      id: "loan-1",
      customerId: "cust-1",
      principalAmount: "500000",
      interestRate: "0.10",
      minInterestDays: 30,
      startDate: new Date("2026-02-20"),
      status: "active",
      loanType: "perpetual",
      termMonths: null,
      penaltyWaived: false,
      issuanceFee: "0.00",
      interestRateOverride: null,
      minPeriodOverride: null,
      issuedBy: "actor-1",
      disbursementSource: "cash",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      penaltyMultiplier: null,
      penaltyWaivedBy: null,
      penaltyWaivedAt: null,
      rolledOverFrom: null,
      rolloverAmount: null,
      backdatedFrom: null,
      backdatedBy: null,
      backdatedAt: null,
      backdateNote: null,
      lowRateReason: null,
    }

    // First select() → loans query → return one loan
    // Second select() → customers query → return customer row
    // Third select() → payments query → return empty
    let selectCallCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++
      const callNum = selectCallCount

      const chain: Record<string, any> = {}
      chain.from = vi.fn().mockImplementation((table: any) => {
        const inner: Record<string, any> = {}

        inner.where = vi.fn().mockImplementation((...args: any[]) => {
          if (table === payments) {
            capturedPaymentsWhere = args[0]
          }

          const next: Record<string, any> = {}
          next.orderBy = vi.fn().mockImplementation(() => {
            const thenable: Record<string, any> = {}
            thenable.then = (resolve: any) => resolve([])
            return thenable
          })

          // For loans query, return the fake loan
          if (callNum === 1) {
            next.then = (resolve: any) => resolve([fakeLoan])
            inner.then = (resolve: any) => resolve([fakeLoan])
          } else {
            next.then = (resolve: any) => resolve([])
            inner.then = (resolve: any) => resolve([])
          }

          return next
        })

        inner.then = (resolve: any) => resolve([])
        return inner
      })

      return chain
    })

    // Act
    const { GET } = await import("@/app/api/cron/overdue/route")
    await GET(buildRequest())

    // Assert – the WHERE clause for the payments query must include
    // eq(payments.markedWrong, false) alongside the other filters.
    expect(capturedPaymentsWhere).toBeDefined()

    // Extract column names referenced in the captured WHERE clause.
    const columns = findColumnNames(capturedPaymentsWhere)

    // Must include the standard filters
    expect(columns).toContain("loan_id")
    expect(columns).toContain("deleted_at")

    // Bug fix assertion: must also filter out markedWrong payments
    expect(columns).toContain("marked_wrong")
  })
})
