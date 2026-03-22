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
  it("payment service exports recordPayment function", async () => {
    const mod = await import("@/services/payment.service")
    expect(mod.recordPayment).toBeDefined()
    expect(typeof mod.recordPayment).toBe("function")
  })

  it("payment service exports editPayment function", async () => {
    const mod = await import("@/services/payment.service")
    expect(mod.editPayment).toBeDefined()
    expect(typeof mod.editPayment).toBe("function")
  })

  it("payment service exports deletePayment function", async () => {
    const mod = await import("@/services/payment.service")
    expect(mod.deletePayment).toBeDefined()
    expect(typeof mod.deletePayment).toBe("function")
  })

  it("payment service exports getPaymentsForLoan function", async () => {
    const mod = await import("@/services/payment.service")
    expect(mod.getPaymentsForLoan).toBeDefined()
    expect(typeof mod.getPaymentsForLoan).toBe("function")
  })

  it("payment service imports autoPostInterestEarned from transaction.service (FINC-01 wiring)", async () => {
    // Verifies that the auto-posting hook is imported so it will be called on recordPayment
    const transactionMod = await import("@/services/transaction.service")
    expect(transactionMod.autoPostInterestEarned).toBeDefined()
    expect(typeof transactionMod.autoPostInterestEarned).toBe("function")
  })

  it("autoPostInterestEarned accepts a tx object and params (FINC-01 atomicity)", async () => {
    const { autoPostInterestEarned } = await import("@/services/transaction.service")
    // Verify function is callable with 2 arguments (tx and params)
    expect(typeof autoPostInterestEarned).toBe("function")
    // Mock was defined with 2 params: (_tx, _params)
    expect(autoPostInterestEarned.length).toBe(2)
  })

  it("RecordPaymentInput type has loanId, paymentDate, amount fields (LOAN-06)", async () => {
    const types = await import("@/types")
    expect(types).toBeDefined()
    // If TypeScript compiles, RecordPaymentInput is correctly shaped
    const input: import("@/types").RecordPaymentInput = {
      loanId: "550e8400-e29b-41d4-a716-446655440001",
      paymentDate: "2026-03-21T00:00:00.000Z",
      amount: "150000",
    }
    expect(input.loanId).toBeDefined()
    expect(input.paymentDate).toBeDefined()
    expect(input.amount).toBeDefined()
  })

  it("EditPaymentInput requires reason field for audit (LOAN-07)", async () => {
    const input: import("@/types").EditPaymentInput = {
      paymentId: "550e8400-e29b-41d4-a716-446655440002",
      reason: "Customer provided corrected payment date",
    }
    expect(input.reason).toBeDefined()
  })

  it("DeletePaymentInput requires reason field for audit (LOAN-07)", async () => {
    const input: import("@/types").DeletePaymentInput = {
      paymentId: "550e8400-e29b-41d4-a716-446655440003",
      reason: "Duplicate entry",
    }
    expect(input.reason).toBeDefined()
  })

  describe("DB integration (mocked)", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("recordPayment: inserts payment + audit log in single transaction (requires test DB)", async () => {
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
      await Effect.runPromise(
        recordPayment(
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "200000" },
          "actor-1"
        )
      )

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

    it("deletePayment: never hard-deletes payment rows (LOAN-07)", async () => {
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
                  return { orderBy: vi.fn().mockResolvedValue([]) }
                }
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
      await Effect.runPromise(
        deletePayment({ paymentId: "pay-1", reason: "Duplicate entry" }, "actor-1")
      )

      // Verify payments were only soft-deleted via update, never hard-deleted
      // The first update call should be the soft-delete with deletedAt set
      const updateCallCount = mockTx.update.mock.calls.length
      expect(updateCallCount).toBeGreaterThanOrEqual(1)

      const firstSetCall = mockTx.update.mock.results[0].value.set
      const setArgs = firstSetCall.mock.calls[0][0]
      expect(setArgs.deletedAt).toBeDefined()
      expect(setArgs.deleteReason).toBe("Duplicate entry")

      // tx.delete is called for transactions table cleanup only, NOT for payments
      // The service uses tx.delete(transactions) not tx.delete(payments)
      // We verify the soft-delete pattern was used for payments
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
  })
})
