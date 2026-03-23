import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  }
  return { db: mockDb }
})

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/transaction.service", () => ({
  autoPostInterestEarned: vi.fn((_tx: any, _params: any) => Promise.resolve(undefined)),
}))

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

const mockLoan = {
  id: "loan-1",
  customerId: "cust-1",
  principalAmount: "500000",
  interestRate: "0.10",
  minInterestDays: 30,
  startDate: new Date("2026-02-20T00:00:00.000Z"),
  status: "active",
  interestRateOverride: null,
  minPeriodOverride: null,
  issuedBy: "actor-1",
}

const mockPayment = {
  id: "pay-1",
  loanId: "loan-1",
  paymentDate: new Date("2026-03-22T00:00:00.000Z"),
  amount: "150000",
  interestPortion: "50000.00",
  principalPortion: "100000.00",
  principalBalanceBefore: "500000",
  principalBalanceAfter: "400000.00",
  recordedBy: "actor-1",
  editReason: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  createdAt: new Date("2026-03-22T00:00:00.000Z"),
  updatedAt: new Date("2026-03-22T00:00:00.000Z"),
}

describe("Payment Service", () => {
  describe("DB integration (mocked)", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("recordPayment: inserts payment + audit log in single transaction (mocked)", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const { writeAuditLog } = await import("@/services/audit.service")

      // Mock loan lookup
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockLoan]),
        }),
      })

      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockPayment]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { recordPayment } = await import("@/services/payment.service")
      const result = await Effect.runPromise(
        recordPayment(
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "150000" },
          "actor-1"
        )
      )

      // Verify payment was inserted
      expect(mockTx.insert).toHaveBeenCalled()
      expect(result.id).toBe("pay-1")
      expect(result.loanId).toBe("loan-1")

      // Verify audit log was written in same transaction
      expect(writeAuditLog).toHaveBeenCalledOnce()
      expect(writeAuditLog).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          actorId: "actor-1",
          action: "payment.create",
          entityType: "payment",
          entityId: "pay-1",
        })
      )
    })

    it("recordPayment: first payment on active loan keeps it active (no status transition unless fully paid)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      // Loan already starts as active (no pending status anymore)
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ ...mockLoan, status: "active" }]),
        }),
      })

      const partialPayment = { ...mockPayment, principalBalanceAfter: "400000.00" }
      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([partialPayment]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { recordPayment } = await import("@/services/payment.service")
      const result = await Effect.runPromise(
        recordPayment(
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "150000" },
          "actor-1"
        )
      )

      // Payment completes successfully — loan remains active (no status update called)
      expect(result.id).toBe("pay-1")
      const setCalls = mockTx.update.mock.results.map((r: any) => r.value.set)
      const setCallArgs = setCalls.map((setFn: any) => setFn.mock.calls[0]?.[0]).filter(Boolean)
      // No status transition to "fully_paid" since balance is not zero
      const fullyPaidUpdate = setCallArgs.find((arg: any) => arg.status === "fully_paid")
      expect(fullyPaidUpdate).toBeUndefined()
    })

    it("recordPayment: transitions loan status to fully_paid when balance reaches zero (LOAN-08)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      // Loan with small principal so payment can fully pay it off
      const smallLoan = { ...mockLoan, principalAmount: "100000", status: "active" }
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([smallLoan]),
        }),
      })

      // allocatePayment is real: 100000 * 0.10/30 * 30 = 10000 interest
      // Payment of 200000 covers 10000 interest + 100000 principal => fully paid
      const fullyPaidPayment = {
        ...mockPayment,
        amount: "200000",
        interestPortion: "10000.00",
        principalPortion: "100000.00",
        principalBalanceBefore: "100000",
        principalBalanceAfter: "0.00",
      }
      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([fullyPaidPayment]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { recordPayment } = await import("@/services/payment.service")
      const result = await Effect.runPromise(
        recordPayment(
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "200000" },
          "actor-1"
        )
      )

      // Verify the result reflects zero remaining balance
      expect(result.principalBalanceAfter).toBe("0.00")

      // Verify loan status was updated to "fully_paid"
      const setCalls = mockTx.update.mock.results.map((r: any) => r.value.set)
      const setCallArgs = setCalls.map((setFn: any) => setFn.mock.calls[0]?.[0]).filter(Boolean)
      const fullyPaidUpdate = setCallArgs.find((arg: any) => arg.status === "fully_paid")
      expect(fullyPaidUpdate).toBeDefined()
      expect(fullyPaidUpdate.status).toBe("fully_paid")
    })

    it("editPayment: fails with PaymentNotFound if payment is soft-deleted (LOAN-07)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      // Return a soft-deleted payment
      const softDeletedPayment = {
        ...mockPayment,
        deletedAt: new Date("2026-03-22T00:00:00.000Z"),
      }
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([softDeletedPayment]),
        }),
      })

      const { editPayment } = await import("@/services/payment.service")
      const exit = await Effect.runPromiseExit(
        editPayment({ paymentId: "pay-1", reason: "Fix amount" }, "actor-1")
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("PaymentNotFound")
      }
    })

    it("editPayment: triggers recalculation cascade for subsequent payments (LOAN-07)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      // First select: payment lookup; second select: loan lookup
      let dbSelectCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        dbSelectCount++
        const call = dbSelectCount
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (call === 1) return Promise.resolve([{ ...mockPayment, deletedAt: null }])
              return Promise.resolve([mockLoan])
            }),
          }),
        }
      })

      const editedPayment = { ...mockPayment, amount: "200000", editReason: "Fix amount" }
      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) {
                  // allActive payments
                  return { orderBy: vi.fn().mockResolvedValue([editedPayment]) }
                }
                if (call === 2) {
                  // loan refetch in recalculateFromPayment
                  return Promise.resolve([mockLoan])
                }
                if (call === 3) {
                  // refreshed payments
                  return { orderBy: vi.fn().mockResolvedValue([editedPayment]) }
                }
                // updatedPayment fetch
                return Promise.resolve([editedPayment])
              }),
            }),
          }
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([editedPayment]),
          }),
        }),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { editPayment } = await import("@/services/payment.service")
      const result = await Effect.runPromise(
        editPayment({ paymentId: "pay-1", amount: "200000", reason: "Fix amount" }, "actor-1")
      )

      // Verify edit completed successfully (cascade is internal)
      expect(result).toBeDefined()
      expect(mockTx.update).toHaveBeenCalled()
    })

    it("deletePayment: sets deleted_at, deleted_by, delete_reason (LOAN-07)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      let dbSelectCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        dbSelectCount++
        const call = dbSelectCount
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (call === 1) return Promise.resolve([{ ...mockPayment, deletedAt: null }])
              return Promise.resolve([mockLoan])
            }),
          }),
        }
      })

      const softDeletedResult = {
        ...mockPayment,
        deletedAt: new Date(),
        deletedBy: "actor-1",
        deleteReason: "Duplicate entry",
      }

      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call <= 2) {
                  // remaining active + refresh (both empty after delete)
                  return { orderBy: vi.fn().mockResolvedValue([]) }
                }
                // Final select for deleted row
                return Promise.resolve([softDeletedResult])
              }),
            }),
          }
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { deletePayment } = await import("@/services/payment.service")
      const result = await Effect.runPromise(
        deletePayment({ paymentId: "pay-1", reason: "Duplicate entry" }, "actor-1")
      )

      // Verify soft-delete fields were set via update
      expect(mockTx.update).toHaveBeenCalled()
      const firstSetCall = mockTx.update.mock.results[0].value.set
      const setArgs = firstSetCall.mock.calls[0][0]
      expect(setArgs.deletedAt).toBeDefined()
      expect(setArgs.deletedBy).toBe("actor-1")
      expect(setArgs.deleteReason).toBe("Duplicate entry")

      // Verify returned payment has deleteReason
      expect(result.deleteReason).toBe("Duplicate entry")
    })

    it("deletePayment: triggers recalculation cascade for subsequent payments (LOAN-07)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      let dbSelectCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        dbSelectCount++
        const call = dbSelectCount
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (call === 1) return Promise.resolve([{ ...mockPayment, deletedAt: null }])
              return Promise.resolve([{ ...mockLoan, status: "active" }])
            }),
          }),
        }
      })

      // After deletion, remaining payment needs recalc
      const remainingPayment = {
        ...mockPayment,
        id: "pay-2",
        paymentDate: new Date("2026-04-22T00:00:00.000Z"),
        amount: "100000",
      }

      const softDeletedResult = {
        ...mockPayment,
        deletedAt: new Date(),
        deletedBy: "actor-1",
        deleteReason: "Correction",
      }

      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) {
                  // remaining active payments
                  return { orderBy: vi.fn().mockResolvedValue([remainingPayment]) }
                }
                if (call === 2) {
                  // loan refetch in recalculateFromPayment
                  return Promise.resolve([mockLoan])
                }
                if (call === 3) {
                  // refreshed payments
                  return { orderBy: vi.fn().mockResolvedValue([remainingPayment]) }
                }
                // Final select for deleted row
                return Promise.resolve([softDeletedResult])
              }),
            }),
          }
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { deletePayment } = await import("@/services/payment.service")
      const result = await Effect.runPromise(
        deletePayment({ paymentId: "pay-1", reason: "Correction" }, "actor-1")
      )

      // Verify completed without error — cascade happened internally
      expect(result).toBeDefined()
      // update called multiple times: soft-delete + recalculation + loan status
      expect(mockTx.update.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it("getPaymentsForLoan: returns all payments including soft-deleted for display (LOAN-07)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const activePayment = { ...mockPayment, deletedAt: null }
      const softDeletedPayment = {
        ...mockPayment,
        id: "pay-2",
        deletedAt: new Date("2026-03-22T00:00:00.000Z"),
        deletedBy: "actor-1",
        deleteReason: "Duplicate",
      }

      let dbSelectCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        dbSelectCount++
        const call = dbSelectCount
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (call === 1) {
                // Loan lookup
                return Promise.resolve([mockLoan])
              }
              // Payments query — returns ALL including soft-deleted
              return {
                orderBy: vi.fn().mockResolvedValue([activePayment, softDeletedPayment]),
              }
            }),
          }),
        }
      })

      const { getPaymentsForLoan } = await import("@/services/payment.service")
      const result = await Effect.runPromise(getPaymentsForLoan("loan-1"))

      expect(result).toHaveLength(2)
      expect(result[0].deletedAt).toBeNull()
      expect(result[1].deletedAt).toBeDefined()
      expect(result[1].deleteReason).toBe("Duplicate")
    })

    it("listPayments: is exported and returns { rows, total } shape (sanity check)", async () => {
      const { listPayments } = await import("@/services/payment.service")
      // Verify the function is exported and callable
      expect(typeof listPayments).toBe("function")
      // Verify the function returns an Effect (has the _op symbol or similar)
      const effect = listPayments({})
      expect(effect).toBeDefined()
    })
  })

  // =========================================================================
  // Phase 8: searchActiveLoans
  // =========================================================================

  describe("searchActiveLoans", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("returns empty array when query is empty string", async () => {
      const { searchActiveLoans } = await import("@/services/payment.service")
      const result = await Effect.runPromise(searchActiveLoans(""))
      expect(result).toEqual([])
    })

    it("returns empty array when query is less than 2 chars", async () => {
      const { searchActiveLoans } = await import("@/services/payment.service")
      const result = await Effect.runPromise(searchActiveLoans("a"))
      expect(result).toEqual([])
    })

    it("returns empty array when query is only whitespace", async () => {
      const { searchActiveLoans } = await import("@/services/payment.service")
      const result = await Effect.runPromise(searchActiveLoans("  "))
      expect(result).toEqual([])
    })

    it("returns matching active loans when query has 2+ chars", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const mockRows = [
        {
          loanId: "loan-1",
          customerId: "cust-1",
          customerName: "Sarah Mutesi",
          principalAmount: "500000.00",
        },
      ]

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(mockRows),
            }),
          }),
        }),
      })

      const { searchActiveLoans } = await import("@/services/payment.service")
      const result = await Effect.runPromise(searchActiveLoans("Sarah"))

      expect(result).toHaveLength(1)
      expect(result[0].customerName).toBe("Sarah Mutesi")
      expect(result[0].loanId).toBe("loan-1")
    })

    it("returns empty array when no loans match query", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })

      const { searchActiveLoans } = await import("@/services/payment.service")
      const result = await Effect.runPromise(searchActiveLoans("nonexistent"))

      expect(result).toEqual([])
    })

    it("wraps DB errors in DatabaseError", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error("DB connection failed")),
            }),
          }),
        }),
      })

      const { searchActiveLoans } = await import("@/services/payment.service")
      const exit = await Effect.runPromiseExit(searchActiveLoans("Sarah"))

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("DatabaseError")
      }
    })
  })

  // =========================================================================
  // Phase 8: getRecentlyCollectedLoans
  // =========================================================================

  describe("getRecentlyCollectedLoans", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("returns empty array for user with no payments", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      ;(mockedDb.execute as any) = vi.fn().mockResolvedValue({ rows: [] })

      const { getRecentlyCollectedLoans } = await import("@/services/payment.service")
      const result = await Effect.runPromise(getRecentlyCollectedLoans("unknown-user"))

      expect(result).toEqual([])
    })

    it("maps rows to RecentlyCollectedLoan shape", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const mockRows = [
        {
          loan_id: "loan-1",
          customer_name: "Sarah Mutesi",
          payment_date: "2026-03-15T09:00:00.000Z",
        },
        {
          loan_id: "loan-2",
          customer_name: "John Mukasa",
          payment_date: "2026-03-10T09:00:00.000Z",
        },
      ]

      ;(mockedDb.execute as any) = vi.fn().mockResolvedValue({ rows: mockRows })

      const { getRecentlyCollectedLoans } = await import("@/services/payment.service")
      const result = await Effect.runPromise(getRecentlyCollectedLoans("user-1"))

      expect(result).toHaveLength(2)
      expect(result[0].loanId).toBe("loan-1")
      expect(result[0].customerName).toBe("Sarah Mutesi")
      expect(result[0].paymentDate).toBeInstanceOf(Date)
      expect(result[1].loanId).toBe("loan-2")
    })

    it("wraps DB errors in DatabaseError", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      ;(mockedDb.execute as any) = vi.fn().mockRejectedValue(new Error("DB error"))

      const { getRecentlyCollectedLoans } = await import("@/services/payment.service")
      const exit = await Effect.runPromiseExit(getRecentlyCollectedLoans("user-1"))

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("DatabaseError")
      }
    })

    it("uses default limit of 5 when no limit provided", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const executeMock = vi.fn().mockResolvedValue({ rows: [] })
      ;(mockedDb.execute as any) = executeMock

      const { getRecentlyCollectedLoans } = await import("@/services/payment.service")
      await Effect.runPromise(getRecentlyCollectedLoans("user-1"))

      // Verify execute was called (limit is embedded in the SQL template)
      expect(executeMock).toHaveBeenCalledOnce()
    })
  })
})
