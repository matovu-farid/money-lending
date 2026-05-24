import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import type { InferSelectModel } from "drizzle-orm"

// Mocked db chain — keys are populated dynamically inside the mock factory and
// returned to the caller. We capture this Drizzle-shaped chain in a recursive
// `unknown`-valued record so we don't need `any`.
type ChainNode = Record<string, unknown>

// A Drizzle SQL node we walk over in `findColumnNames` to discover column
// references. Real `SQL` instances expose `.queryChunks`, which may itself
// hold further `SQL` instances or `Column` references with `.name`/`.table`.
interface SqlLikeNode {
  queryChunks?: ReadonlyArray<SqlLikeNode | { name?: string; table?: unknown }>
}

// ── helpers ────────────────────────────────────────────────────────────
// Recursively extract column names referenced in a Drizzle SQL node.
function findColumnNames(node: unknown): string[] {
  if (!node || typeof node !== "object") return []
  const cols: string[] = []
  const queryChunks = (node as SqlLikeNode).queryChunks
  if (queryChunks) {
    for (const c of queryChunks) {
      const maybeCol = c as { name?: unknown; table?: unknown }
      if (maybeCol.name !== undefined && maybeCol.table !== undefined) {
        if (typeof maybeCol.name === "string") cols.push(maybeCol.name)
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
      const chain: ChainNode = {}
      chain.select = vi.fn().mockReturnValue(chain)

      chain.from = vi.fn().mockImplementation((table: unknown) => {
        const innerChain: ChainNode = {}

        innerChain.where = vi.fn().mockImplementation((...args: unknown[]) => {
          // Detect the payments table by checking the table reference
          if (table === payments) {
            capturedPaymentsWhere = args[0]
          }
          const next: ChainNode = {}
          next.orderBy = vi.fn().mockImplementation(() => {
            const thenable: ChainNode = {}
            thenable.then = (resolve: (value: unknown[]) => unknown) => resolve([])
            return thenable
          })
          next.then = (resolve: (value: unknown[]) => unknown) => resolve([])
          return next
        })

        innerChain.then = (resolve: (value: unknown[]) => unknown) => resolve([])
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
function buildRequest(): NextRequest {
  return new NextRequest("http://localhost/api/cron/overdue", {
    method: "GET",
    headers: { authorization: "Bearer test-secret" },
  })
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

    const fakeLoan: InferSelectModel<typeof loans> = {
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
      subLocationId: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      penaltyMultiplier: "0.1000",
      penaltyWaivedBy: null,
      penaltyWaivedAt: null,
      rolledOverFrom: null,
      rolloverAmount: null,
      backdatedFrom: null,
      backdatedBy: null,
      backdatedAt: null,
      backdateNote: null,
    }

    // First select() → loans query → return one loan
    // Second select() → customers query → return customer row
    // Third select() → payments query → return empty
    let selectCallCount = 0
    ;(db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      selectCallCount++
      const callNum = selectCallCount

      const chain: ChainNode = {}
      chain.from = vi.fn().mockImplementation((table: unknown) => {
        const inner: ChainNode = {}

        inner.where = vi.fn().mockImplementation((...args: unknown[]) => {
          if (table === payments) {
            capturedPaymentsWhere = args[0]
          }

          const next: ChainNode = {}
          next.orderBy = vi.fn().mockImplementation(() => {
            const thenable: ChainNode = {}
            thenable.then = (resolve: (value: unknown[]) => unknown) => resolve([])
            return thenable
          })

          // For loans query, return the fake loan
          if (callNum === 1) {
            next.then = (resolve: (value: unknown[]) => unknown) => resolve([fakeLoan])
            inner.then = (resolve: (value: unknown[]) => unknown) => resolve([fakeLoan])
          } else {
            next.then = (resolve: (value: unknown[]) => unknown) => resolve([])
            inner.then = (resolve: (value: unknown[]) => unknown) => resolve([])
          }

          return next
        })

        inner.then = (resolve: (value: unknown[]) => unknown) => resolve([])
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
