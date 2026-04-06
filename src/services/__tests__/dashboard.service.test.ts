import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn() }
  return { db: mockDb }
})

vi.mock("@/services/creditor.service", () => ({
  getSystemCapital: vi.fn(),
}))

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

function chainedSelect(rows: any[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  }
}

describe("Dashboard Service — Unit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getDashboardKPIs", () => {
    it("returns zeroes when there are no loans or payments", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const { getSystemCapital } = await import("@/services/creditor.service")

      // First call: active loans → empty
      // Second call (per-loan payments): won't be called since no loans
      // Third call: payment stats aggregate
      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // Active loans query
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }
        }
        // Payment stats aggregate
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { totalCollected: null, totalInterestEarned: null },
            ]),
          }),
        }
      })

      ;(getSystemCapital as ReturnType<typeof vi.fn>).mockReturnValue(
        Effect.succeed({ totalOutstanding: "0.00" })
      )

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

    it("computes outstanding from last payment's principalBalanceAfter", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const { getSystemCapital } = await import("@/services/creditor.service")

      const activeLoan = {
        id: "loan-1",
        customerId: "cust-1",
        principalAmount: "1000000.00",
        issuanceFee: "0.00",
        description: "Test loan",
        interestRate: "0.1000",
        minInterestDays: 30,
        startDate: new Date("2026-01-01"),
        interestRateOverride: null,
        minPeriodOverride: null,
        status: "active",
        issuedBy: "actor-1",
        disbursementSource: "cash",
        loanType: "perpetual",
        termMonths: null,
      }

      const mockPayment = {
        principalBalanceAfter: "800000.00",
        interestPortion: "100000.00",
      }

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([activeLoan]),
            }),
          }
        }
        if (selectCallCount === 2) {
          // Per-loan payments (ordered desc)
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([mockPayment]),
              }),
            }),
          }
        }
        // Payment stats aggregate
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { totalCollected: "200000.00", totalInterestEarned: "100000.00" },
            ]),
          }),
        }
      })

      ;(getSystemCapital as ReturnType<typeof vi.fn>).mockReturnValue(
        Effect.succeed({ totalOutstanding: "5000000.00" })
      )

      const { getDashboardKPIs } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getDashboardKPIs())

      expect(result.loansOutstanding).toBe("800000.00")
      expect(result.repaymentsCollected).toBe("200000.00")
      expect(result.interestEarned).toBe("100000.00")
      expect(result.activeBorrowers).toBe(1)
      expect(result.capitalInSystem).toBe("5000000.00")
    })

    it("uses principalAmount when loan has no payments", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const { getSystemCapital } = await import("@/services/creditor.service")

      const activeLoan = {
        id: "loan-1",
        customerId: "cust-1",
        principalAmount: "500000.00",
        issuanceFee: "0.00",
        description: "Test loan",
        interestRate: "0.1000",
        minInterestDays: 30,
        startDate: new Date("2026-03-01"),
        interestRateOverride: null,
        minPeriodOverride: null,
        status: "active",
        issuedBy: "actor-1",
        disbursementSource: "cash",
        loanType: "perpetual",
        termMonths: null,
      }

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([activeLoan]),
            }),
          }
        }
        if (selectCallCount === 2) {
          // No payments
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([]),
              }),
            }),
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { totalCollected: null, totalInterestEarned: null },
            ]),
          }),
        }
      })

      ;(getSystemCapital as ReturnType<typeof vi.fn>).mockReturnValue(
        Effect.succeed({ totalOutstanding: "0.00" })
      )

      const { getDashboardKPIs } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getDashboardKPIs())

      expect(result.loansOutstanding).toBe("500000.00")
    })

    it("counts overdueCount >= 1 when loan is >30 days old with no interest payments", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const { getSystemCapital } = await import("@/services/creditor.service")

      // Loan started 90 days ago — well past the 30-day minimum period
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

      const overdueLoan = {
        id: "loan-overdue",
        customerId: "cust-1",
        principalAmount: "1000000.00",
        issuanceFee: "0.00",
        description: "Test loan",
        interestRate: "0.1000",
        minInterestDays: 30,
        startDate: ninetyDaysAgo,
        interestRateOverride: null,
        minPeriodOverride: null,
        status: "active",
        issuedBy: "actor-1",
        disbursementSource: "cash",
        loanType: "perpetual",
        termMonths: null,
      }

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // Active loans query
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([overdueLoan]),
            }),
          }
        }
        if (selectCallCount === 2) {
          // Per-loan payments — none (no interest payments made)
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([]),
              }),
            }),
          }
        }
        // Payment stats aggregate
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { totalCollected: null, totalInterestEarned: null },
            ]),
          }),
        }
      })

      ;(getSystemCapital as ReturnType<typeof vi.fn>).mockReturnValue(
        Effect.succeed({ totalOutstanding: "0.00" })
      )

      const { getDashboardKPIs } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getDashboardKPIs())

      expect(result.overdueCount).toBeGreaterThanOrEqual(1)
    })

    it("counts distinct active borrowers across multiple loans", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const { getSystemCapital } = await import("@/services/creditor.service")

      // Two loans for same customer — should count as 1 borrower
      const activeLoans = [
        {
          id: "loan-1",
          customerId: "cust-1",
          principalAmount: "500000.00",
          issuanceFee: "0.00",
          description: "Test loan",
          interestRate: "0.1000",
          minInterestDays: 30,
          startDate: new Date("2026-03-01"),
          interestRateOverride: null,
          minPeriodOverride: null,
          status: "active",
          issuedBy: "actor-1",
          disbursementSource: "cash",
          loanType: "perpetual",
          termMonths: null,
        },
        {
          id: "loan-2",
          customerId: "cust-1",
          principalAmount: "300000.00",
          issuanceFee: "0.00",
          description: "Test loan",
          interestRate: "0.1000",
          minInterestDays: 30,
          startDate: new Date("2026-03-01"),
          interestRateOverride: null,
          minPeriodOverride: null,
          status: "active",
          issuedBy: "actor-1",
          disbursementSource: "cash",
          loanType: "perpetual",
          termMonths: null,
        },
      ]

      let selectCallCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(activeLoans),
            }),
          }
        }
        if (selectCallCount <= 3) {
          // Per-loan payments (none)
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([]),
              }),
            }),
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { totalCollected: null, totalInterestEarned: null },
            ]),
          }),
        }
      })

      ;(getSystemCapital as ReturnType<typeof vi.fn>).mockReturnValue(
        Effect.succeed({ totalOutstanding: "0.00" })
      )

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
          // Audit log query
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
        // Customer name lookup
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
          id: "audit-3",
          actorId: "actor-1",
          action: "payment.delete",
          entityType: "payment",
          entityId: "pay-1",
          afterValue: null,
          occurredAt: new Date("2026-03-23T12:00:00Z"),
        },
        {
          id: "audit-4",
          actorId: "actor-1",
          action: "payment.update",
          entityType: "payment",
          entityId: "pay-2",
          afterValue: null,
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

    it("handles unknown entity/action as generic description", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const entry = {
        id: "audit-5",
        actorId: "actor-1",
        action: "loan.update",
        entityType: "loan",
        entityId: "loan-1",
        afterValue: JSON.stringify({}),
        occurredAt: new Date("2026-03-23T13:00:00Z"),
      }

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([entry]),
            }),
          }),
        }),
      })

      const { getRecentActivity } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getRecentActivity())

      expect(result).toHaveLength(1)
      expect(result[0].description).toBe("loan loan.update")
    })

    it("handles loan.create with missing customerId gracefully", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const entry = {
        id: "audit-6",
        actorId: "actor-1",
        action: "loan.create",
        entityType: "loan",
        entityId: "loan-2",
        afterValue: JSON.stringify({ principalAmount: "250000" }),
        occurredAt: new Date("2026-03-23T14:00:00Z"),
      }

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([entry]),
            }),
          }),
        }),
      })

      const { getRecentActivity } = await import("@/services/dashboard.service")
      const result = await Effect.runPromise(getRecentActivity())

      expect(result).toHaveLength(1)
      expect(result[0].type).toBe("loan_issued")
      expect(result[0].description).toContain("250,000")
      // No customer name since no customerId
      expect(result[0].customerId).toBeUndefined()
    })
  })
})
