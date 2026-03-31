import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn() }
  return { db: mockDb }
})

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

const makePaymentRow = (overrides: Record<string, unknown> = {}) => ({
  paymentId: "pay-1",
  loanId: "loan-1",
  customerName: "John Doe",
  amount: "150000.00",
  interestPortion: "100000.00",
  principalPortion: "50000.00",
  paymentDate: new Date("2026-03-23T09:00:00.000Z"),
  ...overrides,
})

const makeLoan = (overrides: Record<string, unknown> = {}) => ({
  id: "loan-1",
  customerId: "cust-1",
  principalAmount: "1000000.00",
  interestRate: "0.1000",
  minInterestDays: 30,
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  status: "active",
  interestRateOverride: null,
  minPeriodOverride: null,
  issuedBy: "actor-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
})

const makeCustomer = (overrides: Record<string, unknown> = {}) => ({
  id: "cust-1",
  fullName: "John Doe",
  contact: "+256700000000",
  address: "Kampala",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const makePayment = (overrides: Record<string, unknown> = {}) => ({
  id: "pay-1",
  loanId: "loan-1",
  paymentDate: new Date("2026-02-01T00:00:00.000Z"),
  amount: "100000.00",
  interestPortion: "100000.00",
  principalPortion: "0.00",
  principalBalanceBefore: "1000000.00",
  principalBalanceAfter: "1000000.00",
  recordedBy: "actor-1",
  editReason: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

function chainedSelect(rows: unknown[]) {
  const terminal = {
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      return Promise.resolve(rows).then(resolve, reject)
    },
    orderBy: vi.fn().mockResolvedValue(rows),
  }
  const whereObj = { where: vi.fn().mockReturnValue(terminal) }
  const innerJoin2 = {
    where: vi.fn().mockReturnValue(terminal),
    innerJoin: vi.fn().mockReturnValue(whereObj),
  }
  const innerJoin1 = {
    innerJoin: vi.fn().mockReturnValue(innerJoin2),
    where: vi.fn().mockReturnValue(terminal),
  }
  const chain = {
    from: vi.fn().mockReturnValue(innerJoin1),
  }
  return chain
}

describe("daily-collections.service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe("getDailyCollections", () => {
    it("returns total and count for date with payments", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const row1 = makePaymentRow({ amount: "150000.00" })
      const row2 = makePaymentRow({ paymentId: "pay-2", amount: "150000.00" })
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue(
        chainedSelect([row1, row2])
      )

      const { getDailyCollections } = await import(
        "@/services/daily-collections.service"
      )
      const result = await Effect.runPromise(getDailyCollections("2026-03-23"))

      expect(result.date).toBe("2026-03-23")
      expect(result.totalCollected).toBe("300000.00")
      expect(result.paymentCount).toBe(2)
      expect(result.rows).toHaveLength(2)
    })

    it("returns zero totals for date with no payments", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue(
        chainedSelect([])
      )

      const { getDailyCollections } = await import(
        "@/services/daily-collections.service"
      )
      const result = await Effect.runPromise(getDailyCollections("2026-01-01"))

      expect(result.date).toBe("2026-01-01")
      expect(result.totalCollected).toBe("0.00")
      expect(result.paymentCount).toBe(0)
      expect(result.rows).toEqual([])
    })

    it("sums amounts using BigNumber precision", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      // Use values that would lose precision with floating-point arithmetic
      const row1 = makePaymentRow({ amount: "150000.50" })
      const row2 = makePaymentRow({ paymentId: "pay-2", amount: "250000.75" })
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue(
        chainedSelect([row1, row2])
      )

      const { getDailyCollections } = await import(
        "@/services/daily-collections.service"
      )
      const result = await Effect.runPromise(getDailyCollections("2026-03-23"))

      // BigNumber precision: 150000.50 + 250000.75 = 400001.25 exactly
      expect(result.totalCollected).toBe("400001.25")
    })
  })

  describe("getLoansDueToday", () => {
    it("returns loans overdue 30+ days", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-03-23T00:00:00.000Z"))

      // Loan started 60 days ago, no payments
      const loan = makeLoan({
        startDate: new Date("2026-01-22T00:00:00.000Z"),
      })
      const customer = makeCustomer({ id: "cust-1", fullName: "Jane Due" })

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const callIndex = selectCallCount++
        if (callIndex === 0) return chainedSelect([loan])     // active loans
        if (callIndex === 1) return chainedSelect([])         // payments (none)
        if (callIndex === 2) return chainedSelect([customer]) // customer lookup
        return chainedSelect([])
      })

      const { getLoansDueToday } = await import(
        "@/services/daily-collections.service"
      )
      const result = await Effect.runPromise(getLoansDueToday())

      expect(result).toHaveLength(1)
      expect(result[0].loanId).toBe("loan-1")
      expect(result[0].customerName).toBe("Jane Due")
      expect(result[0].daysSinceLastPayment).toBeGreaterThanOrEqual(30)
      expect(result[0].lastPaymentDate).toBeNull()
    })

    it("excludes loans with recent payments", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-03-23T00:00:00.000Z"))

      const loan = makeLoan({
        startDate: new Date("2026-01-01T00:00:00.000Z"),
      })
      // Payment was made 5 days ago — well within 30-day threshold
      const recentPayment = makePayment({
        paymentDate: new Date("2026-03-18T00:00:00.000Z"), // 5 days ago
      })

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const callIndex = selectCallCount++
        if (callIndex === 0) return chainedSelect([loan])           // active loans
        if (callIndex === 1) return chainedSelect([recentPayment])  // payments
        return chainedSelect([])
      })

      const { getLoansDueToday } = await import(
        "@/services/daily-collections.service"
      )
      const result = await Effect.runPromise(getLoansDueToday())

      expect(result).toEqual([])
    })

    it("uses startDate for loans with no payments", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-03-23T00:00:00.000Z"))

      // Loan started 45 days ago, no payments
      const loan = makeLoan({
        id: "loan-new",
        startDate: new Date("2026-02-06T00:00:00.000Z"), // 45 days ago
      })
      const customer = makeCustomer({ id: "cust-1", fullName: "New Borrower" })

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const callIndex = selectCallCount++
        if (callIndex === 0) return chainedSelect([loan])
        if (callIndex === 1) return chainedSelect([])         // no payments
        if (callIndex === 2) return chainedSelect([customer])
        return chainedSelect([])
      })

      const { getLoansDueToday } = await import(
        "@/services/daily-collections.service"
      )
      const result = await Effect.runPromise(getLoansDueToday())

      expect(result).toHaveLength(1)
      expect(result[0].loanId).toBe("loan-new")
      // daysSinceLastPayment should be computed from startDate
      expect(result[0].daysSinceLastPayment).toBeGreaterThanOrEqual(30)
      expect(result[0].lastPaymentDate).toBeNull()
      // outstandingBalance should be the principal (no payments made)
      expect(result[0].outstandingBalance).toBe("1000000.00")
    })

    it("sorts by daysSinceLastPayment descending", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-03-23T00:00:00.000Z"))

      // Loan 1: started 60 days ago
      const loan1 = makeLoan({
        id: "loan-60",
        customerId: "cust-1",
        startDate: new Date("2026-01-22T00:00:00.000Z"),
      })
      // Loan 2: started 90 days ago (more overdue)
      const loan2 = makeLoan({
        id: "loan-90",
        customerId: "cust-2",
        startDate: new Date("2025-12-23T00:00:00.000Z"),
      })

      const customer1 = makeCustomer({ id: "cust-1", fullName: "Customer One" })
      const customer2 = makeCustomer({ id: "cust-2", fullName: "Customer Two" })

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const callIndex = selectCallCount++
        if (callIndex === 0) return chainedSelect([loan1, loan2]) // active loans
        if (callIndex === 1) return chainedSelect([])             // payments for loan1
        if (callIndex === 2) return chainedSelect([customer1])    // customer for loan1
        if (callIndex === 3) return chainedSelect([])             // payments for loan2
        if (callIndex === 4) return chainedSelect([customer2])    // customer for loan2
        return chainedSelect([])
      })

      const { getLoansDueToday } = await import(
        "@/services/daily-collections.service"
      )
      const result = await Effect.runPromise(getLoansDueToday())

      expect(result).toHaveLength(2)
      // loan-90 should come first (most days since last payment)
      expect(result[0].loanId).toBe("loan-90")
      expect(result[1].loanId).toBe("loan-60")
      expect(result[0].daysSinceLastPayment).toBeGreaterThan(
        result[1].daysSinceLastPayment
      )
    })
  })
})
