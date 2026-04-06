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

vi.mock("@/services/transaction.service", () => ({
  getLoanBalancesFromLedger: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("@/lib/interest/overdue", () => ({
  computeLoanOverdueInfo: vi.fn().mockReturnValue({ daysOverdue: 0, dailyRate: "0", unpaidInterest: "0" }),
}))

/**
 * Helper: build a chained mock for a drizzle select().from().innerJoin().where().groupBy() chain.
 * Returns the resolved rows at the end of the chain.
 */
function ledgerQuery(rows: any[]) {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  }
}

function simpleWhere(rows: any[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  }
}

function whereOrderBy(rows: any[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
    }),
  }
}

describe("Dashboard Service — Unit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe("getDashboardKPIs", () => {
    it("returns zeroes when ledger is empty and no active loans", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) return ledgerQuery([]) // empty ledger
        return simpleWhere([]) // no active loans
      })

      const { getDashboardKPIs } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getDashboardKPIs())

      expect(result).toEqual({
        loansOutstanding: "0.00",
        repaymentsCollected: "0.00",
        interestEarned: "0.00",
        activeBorrowers: 0,
        overdueCount: 0,
        capitalInSystem: "0.00",
      })
    })

    it("derives loansOutstanding and interestEarned from ledger", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const ledgerRows = [
        { categoryName: "Loans Receivable", txType: "debit", referenceType: "loan", total: "1000000.00" },
        { categoryName: "Loans Receivable", txType: "credit", referenceType: "payment", total: "200000.00" },
        { categoryName: "Interest Earned", txType: "credit", referenceType: "payment", total: "100000.00" },
        { categoryName: "Cash", txType: "debit", referenceType: "payment", total: "300000.00" },
        { categoryName: "Cash", txType: "debit", referenceType: "loan", total: "50000.00" }, // issuance fee — not counted as repayment
        { categoryName: "Creditor Investment", txType: "credit", referenceType: "creditor_investment", total: "5000000.00" },
      ]

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) return ledgerQuery(ledgerRows)
        return simpleWhere([]) // no active loans
      })

      const { getDashboardKPIs } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getDashboardKPIs())

      // Loans Receivable: 1,000,000 DR - 200,000 CR = 800,000
      expect(result.loansOutstanding).toBe("800000.00")
      // Interest Earned: 100,000 CR - 0 DR = 100,000
      expect(result.interestEarned).toBe("100000.00")
      // Cash from payments: 300,000 DR - 0 CR = 300,000 (issuance fee excluded)
      expect(result.repaymentsCollected).toBe("300000.00")
      // Creditor Investment: 5,000,000 CR - 0 DR = 5,000,000
      expect(result.capitalInSystem).toBe("5000000.00")
    })

    it("handles payment reversals correctly in ledger totals", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const ledgerRows = [
        { categoryName: "Loans Receivable", txType: "debit", referenceType: "loan", total: "500000.00" },
        // Payment made
        { categoryName: "Cash", txType: "debit", referenceType: "payment", total: "100000.00" },
        { categoryName: "Interest Earned", txType: "credit", referenceType: "payment", total: "50000.00" },
        // Payment reversed
        { categoryName: "Cash", txType: "credit", referenceType: "payment_reversal", total: "100000.00" },
        { categoryName: "Interest Earned", txType: "debit", referenceType: "payment_reversal", total: "50000.00" },
      ]

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) return ledgerQuery(ledgerRows)
        return simpleWhere([])
      })

      const { getDashboardKPIs } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getDashboardKPIs())

      // Net cash from payments: 100k DR - 100k CR = 0
      expect(result.repaymentsCollected).toBe("0.00")
      // Net interest: 50k CR - 50k DR = 0
      expect(result.interestEarned).toBe("0.00")
      // Loans Receivable: 500k DR only (reversal restores balance)
      expect(result.loansOutstanding).toBe("500000.00")
    })

    it("counts overdueCount for loans >30 days old with no interest payments", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const { computeLoanOverdueInfo } = await import("@/lib/interest/overdue")

      // Make computeLoanOverdueInfo return overdue for this test
      ;(computeLoanOverdueInfo as ReturnType<typeof vi.fn>).mockReturnValue({
        daysOverdue: 90, dailyRate: "3333.33", unpaidInterest: "300000.00",
      })

      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

      const overdueLoan = {
        id: "loan-overdue",
        customerId: "cust-1",
        principalAmount: "1000000.00",
        interestRate: "0.1000",
        startDate: ninetyDaysAgo,
        interestRateOverride: null,
        status: "active",
        loanType: "perpetual",
        termMonths: null,
      }

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) return ledgerQuery([])
        if (selectCallCount === 2) return simpleWhere([overdueLoan]) // active loans
        return whereOrderBy([]) // no payments
      })

      const { getDashboardKPIs } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getDashboardKPIs())

      expect(result.overdueCount).toBeGreaterThanOrEqual(1)
    })

    it("counts distinct active borrowers across multiple loans", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const activeLoans = [
        {
          id: "loan-1", customerId: "cust-1", principalAmount: "500000.00",
          interestRate: "0.1000", startDate: new Date("2026-03-01"),
          interestRateOverride: null, status: "active", loanType: "perpetual", termMonths: null,
        },
        {
          id: "loan-2", customerId: "cust-1", principalAmount: "300000.00",
          interestRate: "0.1000", startDate: new Date("2026-03-01"),
          interestRateOverride: null, status: "active", loanType: "perpetual", termMonths: null,
        },
      ]

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) return ledgerQuery([])
        if (selectCallCount === 2) return simpleWhere(activeLoans)
        return whereOrderBy([]) // no payments
      })

      const { getDashboardKPIs } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getDashboardKPIs())

      expect(result.activeBorrowers).toBe(1)
    })
  })

  describe("getRecentActivity", () => {
    it("returns empty array when no audit entries exist", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })

      const { getRecentActivity } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getRecentActivity())

      expect(result).toEqual([])
    })

    it("maps loan.create audit entry to loan_issued activity", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const auditEntry = {
        id: "audit-1",
        actorId: "actor-1",
        action: "loan.create",
        entityType: "loan",
        entityId: "loan-1",
        afterValue: JSON.stringify({
          customerId: "cust-1",
          principalAmount: "500000",
          interestRate: "0.10",
          startDate: "2026-03-01",
          collateral: { nature: "Land Title" },
        }),
        occurredAt: new Date("2026-03-23T10:00:00Z"),
      }

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([auditEntry]),
                }),
              }),
            }),
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ fullName: "John Doe" }]),
            }),
          }),
        }
      })

      const { getRecentActivity } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getRecentActivity())

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe("loan_issued")
      expect(result[0].description).toContain("John Doe")
      expect(result[0].description).toContain("500,000")
      expect(result[0].loanId).toBe("loan-1")
      expect(result[0].customerId).toBe("cust-1")
      expect(result[0].detail?.amount).toBe("500000")
      expect(result[0].detail?.collateral).toBe("Land Title")
    })

    it("maps payment.create audit entry to payment_received activity", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const auditEntry = {
        id: "audit-2",
        actorId: "actor-1",
        action: "payment.create",
        entityType: "payment",
        entityId: "pay-1",
        afterValue: JSON.stringify({
          loanId: "loan-1",
          amount: "100000",
          paymentDate: "2026-03-15",
          interestPortion: "50000",
          principalPortion: "50000",
        }),
        occurredAt: new Date("2026-03-23T11:00:00Z"),
      }

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([auditEntry]),
            }),
          }),
        }),
      })

      const { getRecentActivity } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getRecentActivity())

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe("payment_received")
      expect(result[0].description).toContain("100,000")
      expect(result[0].loanId).toBe("loan-1")
      expect(result[0].detail?.interestPortion).toBe("50000")
      expect(result[0].detail?.principalPortion).toBe("50000")
    })

    it("handles payment.delete and payment.update entries", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const entries = [
        {
          id: "audit-3", actorId: "actor-1", action: "payment.delete",
          entityType: "payment", entityId: "pay-1", afterValue: null,
          occurredAt: new Date("2026-03-23T12:00:00Z"),
        },
        {
          id: "audit-4", actorId: "actor-1", action: "payment.update",
          entityType: "payment", entityId: "pay-2", afterValue: null,
          occurredAt: new Date("2026-03-23T12:01:00Z"),
        },
      ]

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(entries),
            }),
          }),
        }),
      })

      const { getRecentActivity } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getRecentActivity())

      expect(result).toHaveLength(2)
      expect(result[0].description).toBe("Payment deleted")
      expect(result[1].description).toBe("Payment updated")
    })
  })
})
