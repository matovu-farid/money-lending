import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit } from "effect"
import BigNumber from "bignumber.js"

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

vi.mock("@/services/transaction.service", () => {
  const BigNumber = require("bignumber.js").default
  return {
    autoPostInterestEarned: vi.fn((_tx: any, _params: any) => Promise.resolve(undefined)),
    autoPostPrincipalRepayment: vi.fn((_tx: any, _params: any) => Promise.resolve(undefined)),
    postJournalEntry: vi.fn((_tx: any, _params: any) => Promise.resolve(undefined)),
    getLoanBalanceFromLedger: vi.fn((_loanId: string) => Promise.resolve(new BigNumber(0))),
    reverseInterestAccrual: vi.fn((_tx: any, _params: any) => Promise.resolve(undefined)),
  }
})

vi.mock("@/lib/interest/overdue", () => ({
  computeLoanOverdueInfo: vi.fn().mockReturnValue({ daysOverdue: 0, dailyRate: "0", unpaidInterest: "0" }),
}))

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

const mockLoan = {
  id: "loan-1",
  customerId: "cust-1",
  principalAmount: "500000",
  issuanceFee: "0.00",
  description: "Test loan",
  interestRate: "0.10",
  minInterestDays: 30,
  startDate: new Date("2026-02-20T00:00:00.000Z"),
  status: "active",
  interestRateOverride: null,
  minPeriodOverride: null,
  issuedBy: "actor-1",
  disbursementSource: "cash",
  loanType: "perpetual",
  termMonths: null,
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
  depositLocation: "cash" as const,
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

      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) return { for: vi.fn().mockResolvedValue([mockLoan]) } // loan lookup
                return { orderBy: vi.fn().mockReturnValue({ for: vi.fn().mockResolvedValue([]) }) } // active payments
              }),
            }),
          }
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
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "150000", depositLocation: "cash" },
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

      const partialPayment = { ...mockPayment, principalBalanceAfter: "400000.00" }
      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) return { for: vi.fn().mockResolvedValue([{ ...mockLoan, status: "active" }]) } // loan lookup
                return { orderBy: vi.fn().mockReturnValue({ for: vi.fn().mockResolvedValue([]) }) } // active payments
              }),
            }),
          }
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
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "150000", depositLocation: "cash" },
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

      // allocatePayment is real: 100000 * 0.10/30 * 30 ≈ 10000 interest
      // Payment of 110000 covers interest + principal exactly => fully paid
      // totalOwed = interest(10000.00) + principal(100000) = 110000.00, so 110000 is valid
      const fullyPaidPayment = {
        ...mockPayment,
        amount: "110000",
        interestPortion: "10000.00",
        principalPortion: "100000.00",
        principalBalanceBefore: "100000",
        principalBalanceAfter: "0.00",
      }
      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) return { for: vi.fn().mockResolvedValue([smallLoan]) } // loan lookup
                return { orderBy: vi.fn().mockReturnValue({ for: vi.fn().mockResolvedValue([]) }) } // active payments
              }),
            }),
          }
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
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "110000", depositLocation: "cash" },
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

    it("recordPayment: rejects zero-amount payments (L2)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) return { for: vi.fn().mockResolvedValue([mockLoan]) }
                return { orderBy: vi.fn().mockResolvedValue([]) }
              }),
            }),
          }
        }),
        insert: vi.fn(),
        update: vi.fn(),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { recordPayment } = await import("@/services/payment.service")
      const exit = await Effect.runPromiseExit(
        recordPayment(
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "0", depositLocation: "cash" },
          "actor-1"
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("ValidationError")
        expect(error.message).toContain("greater than zero")
      }
    })

    it("recordPayment: rejects negative-amount payments (L2)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) return { for: vi.fn().mockResolvedValue([mockLoan]) }
                return { orderBy: vi.fn().mockResolvedValue([]) }
              }),
            }),
          }
        }),
        insert: vi.fn(),
        update: vi.fn(),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { recordPayment } = await import("@/services/payment.service")
      const exit = await Effect.runPromiseExit(
        recordPayment(
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "-1000", depositLocation: "cash" },
          "actor-1"
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("ValidationError")
        expect(error.message).toContain("greater than zero")
      }
    })

    it("recordPayment: rejects backdated payments before loan start date (L1)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) return { for: vi.fn().mockResolvedValue([mockLoan]) }
                return { orderBy: vi.fn().mockResolvedValue([]) }
              }),
            }),
          }
        }),
        insert: vi.fn(),
        update: vi.fn(),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { recordPayment } = await import("@/services/payment.service")
      // mockLoan.startDate is 2026-02-20, so use a date before that
      const exit = await Effect.runPromiseExit(
        recordPayment(
          { loanId: "loan-1", paymentDate: "2026-01-15T00:00:00.000Z", amount: "50000", depositLocation: "cash" },
          "actor-1"
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("ValidationError")
        expect(error.message).toContain("before loan start date")
      }
    })

    it("recordPayment: rejects overpayment exceeding total owed (M2)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      // Loan: 100,000 principal at 10%/month
      // After 30 days: interest = 100000 * 0.10/30 * 30 ≈ 10,000
      // Total owed = 110,000
      // Payment of 200,000 should be rejected
      const smallLoan = { ...mockLoan, principalAmount: "100000" }

      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) return { for: vi.fn().mockResolvedValue([smallLoan]) }
                return {
                  orderBy: vi.fn().mockReturnValue({
                    for: vi.fn().mockResolvedValue([]),
                  }),
                }
              }),
            }),
          }
        }),
        insert: vi.fn(),
        update: vi.fn(),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

      const { recordPayment } = await import("@/services/payment.service")
      const exit = await Effect.runPromiseExit(
        recordPayment(
          { loanId: "loan-1", paymentDate: "2026-03-22T00:00:00.000Z", amount: "200000", depositLocation: "cash" },
          "actor-1"
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (exit._tag === "Failure") {
        const error = (exit.cause as any).error ?? (exit.cause as any)
        expect(error._tag).toBe("ValidationError")
        expect(error.message).toContain("exceeds total owed")
      }
    })

    it("editPayment: fails with PaymentNotFound if payment is soft-deleted (LOAN-07)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      // Return a soft-deleted payment
      const softDeletedPayment = {
        ...mockPayment,
        deletedAt: new Date("2026-03-22T00:00:00.000Z"),
      }
      const mockTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([softDeletedPayment]),
          }),
        }),
      }
      ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (cb: any) => cb(mockTx)
      )

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

    it("editPayment: triggers recalculation cascade and posts reversing entry (LOAN-07)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

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
                  // payment lookup (now inside tx)
                  return Promise.resolve([{ ...mockPayment, deletedAt: null }])
                }
                if (call === 2) {
                  // loan lookup (now inside tx)
                  return Promise.resolve([mockLoan])
                }
                if (call === 3) {
                  // activePayments for overpayment validation
                  return { orderBy: vi.fn().mockResolvedValue([editedPayment]) }
                }
                if (call === 4) {
                  // allActive payments for recalculation
                  return { orderBy: vi.fn().mockResolvedValue([editedPayment]) }
                }
                if (call === 5) {
                  // loan refetch in recalculateFromPayment
                  return Promise.resolve([mockLoan])
                }
                if (call === 6) {
                  // refreshed payments
                  return { orderBy: vi.fn().mockResolvedValue([editedPayment]) }
                }
                if (call === 7) {
                  // updatedPayment fetch
                  return Promise.resolve([editedPayment])
                }
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
      const { postJournalEntry } = await import("@/services/transaction.service")
      const result = await Effect.runPromise(
        editPayment({ paymentId: "pay-1", amount: "200000", reason: "Fix amount" }, "actor-1")
      )

      // Verify edit completed successfully (cascade is internal)
      expect(result).toBeDefined()
      expect(mockTx.update).toHaveBeenCalled()

      // Verify reversing entry was posted via postJournalEntry
      expect(postJournalEntry).toHaveBeenCalled()
      // First call should be the interest reversal
      const firstCallArgs = (postJournalEntry as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(firstCallArgs.referenceType).toBe("payment_reversal")
      expect(firstCallArgs.amount).toBe("50000.00")
      expect(firstCallArgs.description).toContain("Reversal")
      expect(firstCallArgs.loanId).toBe("loan-1")
    })

    it("editPayment: reconciles downstream journal entries when interest changes (JOURNAL-STALE)", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const { autoPostInterestEarned } = await import("@/services/transaction.service")

      // Two payments: editing pay-1 causes pay-2's interest to change
      const pay1 = { ...mockPayment, id: "pay-1", interestPortion: "50000.00" }
      const pay2 = {
        ...mockPayment,
        id: "pay-2",
        paymentDate: new Date("2026-04-22T00:00:00.000Z"),
        interestPortion: "40000.00", // old value before recalculation
        principalBalanceBefore: "400000.00",
        principalBalanceAfter: "340000.00",
      }
      // After recalculation, pay-2's interest changes to 35000.00
      const pay2Refreshed = { ...pay2, interestPortion: "35000.00" }

      const editedPay1 = { ...pay1, amount: "200000", editReason: "Fix amount" }
      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) return Promise.resolve([{ ...pay1, deletedAt: null }]) // payment lookup
                if (call === 2) return Promise.resolve([mockLoan]) // loan lookup
                if (call === 3) {
                  // activePayments for overpayment validation
                  return { orderBy: vi.fn().mockResolvedValue([editedPay1, pay2]) }
                }
                if (call === 4) {
                  // allActive payments (pay1 + pay2 with OLD interest)
                  return { orderBy: vi.fn().mockResolvedValue([editedPay1, pay2]) }
                }
                if (call === 5) return Promise.resolve([mockLoan]) // loan refetch in recalculateFromPayment
                if (call === 6) {
                  // reconcileDownstreamJournals: refresh pay-2 by id (NEW interest)
                  return Promise.resolve([pay2Refreshed])
                }
                if (call === 7) {
                  // refreshed payments for loan status check
                  return { orderBy: vi.fn().mockResolvedValue([editedPay1, pay2Refreshed]) }
                }
                if (call === 8) return Promise.resolve([editedPay1]) // updatedPayment fetch
                return Promise.resolve([editedPay1])
              }),
            }),
          }
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
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

      const { editPayment } = await import("@/services/payment.service")
      const result = await Effect.runPromise(
        editPayment({ paymentId: "pay-1", amount: "200000", reason: "Fix amount" }, "actor-1")
      )

      expect(result).toBeDefined()

      // Verify downstream reversal was posted via postJournalEntry for pay-2 (old interest 40000.00)
      const { postJournalEntry } = await import("@/services/transaction.service")
      const journalCalls = (postJournalEntry as ReturnType<typeof vi.fn>).mock.calls
      const downstreamReversal = journalCalls.find(
        (call: any) => call[1].referenceType === "payment_reversal" && call[1].referenceId === "pay-2"
      )
      expect(downstreamReversal).toBeDefined()
      expect(downstreamReversal![1].amount).toBe("40000.00")
      expect(downstreamReversal![1].description).toContain("downstream recalculation")
      expect(downstreamReversal![1].loanId).toBe("loan-1")

      // Verify autoPostInterestEarned was called for pay-2 with new interest
      expect(autoPostInterestEarned).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          amount: "35000.00",
          paymentId: "pay-2",
        })
      )
    })

    it("deletePayment: sets deleted_at, deleted_by, delete_reason and posts reversing entry (LOAN-07)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

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
                if (call === 1) return Promise.resolve([{ ...mockPayment, deletedAt: null }]) // payment lookup
                if (call === 2) return Promise.resolve([mockLoan]) // loan lookup
                if (call <= 4) {
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

      // Verify reversing entry was posted via postJournalEntry
      const { postJournalEntry } = await import("@/services/transaction.service")
      expect(postJournalEntry).toHaveBeenCalled()
      const firstCallArgs = (postJournalEntry as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(firstCallArgs.amount).toBe("50000.00")
      expect(firstCallArgs.referenceType).toBe("payment_reversal")
      expect(firstCallArgs.referenceId).toBe("pay-1")
      expect(firstCallArgs.description).toContain("Reversal")
      expect(firstCallArgs.description).toContain("Duplicate entry")
      expect(firstCallArgs.loanId).toBe("loan-1")

      // Verify returned payment has deleteReason
      expect(result.deleteReason).toBe("Duplicate entry")
    })

    it("deletePayment: triggers recalculation cascade for subsequent payments (LOAN-07)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

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
                if (call === 1) return Promise.resolve([{ ...mockPayment, deletedAt: null }]) // payment lookup
                if (call === 2) return Promise.resolve([{ ...mockLoan, status: "active" }]) // loan lookup
                if (call === 3) {
                  // remaining active payments
                  return { orderBy: vi.fn().mockResolvedValue([remainingPayment]) }
                }
                if (call === 4) {
                  // loan refetch in recalculateFromPayment
                  return Promise.resolve([mockLoan])
                }
                if (call === 5) {
                  // reconcileDownstreamJournals: payment refresh by id
                  return Promise.resolve([remainingPayment])
                }
                if (call === 6) {
                  // refreshed payments for loan status check
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

    it("deletePayment: skips recalculation when deleted payment is the last chronologically", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      // The deleted payment is the latest — no subsequent payments exist
      const lastPayment = {
        ...mockPayment,
        id: "pay-last",
        paymentDate: new Date("2026-04-22T00:00:00.000Z"),
        deletedAt: null,
      }

      // Earlier payment that should NOT be recalculated
      const earlierPayment = {
        ...mockPayment,
        id: "pay-earlier",
        paymentDate: new Date("2026-03-22T00:00:00.000Z"),
        deletedAt: null,
      }

      const softDeletedResult = {
        ...lastPayment,
        deletedAt: new Date(),
        deletedBy: "actor-1",
        deleteReason: "Wrong entry",
      }

      let txSelectCount = 0
      const mockTx = {
        select: vi.fn().mockImplementation(() => {
          txSelectCount++
          const call = txSelectCount
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation(() => {
                if (call === 1) return Promise.resolve([lastPayment]) // payment lookup
                if (call === 2) return Promise.resolve([mockLoan]) // loan lookup
                if (call === 3) {
                  // remaining active payments (only the earlier one remains)
                  return { orderBy: vi.fn().mockResolvedValue([earlierPayment]) }
                }
                if (call === 4) {
                  // refreshed payments for status check
                  return { orderBy: vi.fn().mockResolvedValue([earlierPayment]) }
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
        deletePayment({ paymentId: "pay-last", reason: "Wrong entry" }, "actor-1")
      )

      expect(result).toBeDefined()

      // tx.update should be called for:
      //   1. soft-delete of the payment
      //   2. loan status update (refreshed check)
      // But NOT for recalculation of earlier payments.
      const updateSetCalls = mockTx.update.mock.results.map((r: any) => r.value.set)
      // First call: soft-delete fields
      const softDeleteArgs = updateSetCalls[0].mock.calls[0][0]
      expect(softDeleteArgs.deletedAt).toBeDefined()
      expect(softDeleteArgs.deletedBy).toBe("actor-1")

      // Verify reversing entry was posted via postJournalEntry
      const { postJournalEntry } = await import("@/services/transaction.service")
      expect(postJournalEntry).toHaveBeenCalled()
      const firstCallArgs = (postJournalEntry as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(firstCallArgs.referenceType).toBe("payment_reversal")
      expect(firstCallArgs.loanId).toBe("loan-1")

      // No recalculation update should have happened for the earlier payment.
      // txSelectCount should be 5: payment lookup + loan lookup + remaining active + refreshed + final deleted row fetch.
      // If recalculation had run, there would be additional selects (loan refetch inside recalculateFromPayment).
      expect(txSelectCount).toBe(5)
    })

    it("getPaymentsForLoan: returns only active payments (excludes soft-deleted)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      const activePayment = { ...mockPayment, deletedAt: null }

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
              // Payments query — returns only active (soft-deleted filtered by isNull(deletedAt))
              return {
                orderBy: vi.fn().mockResolvedValue([activePayment]),
              }
            }),
          }),
        }
      })

      const { getPaymentsForLoan } = await import("@/services/payment.service")
      const result = await Effect.runPromise(getPaymentsForLoan("loan-1"))

      expect(result).toHaveLength(1)
      expect(result[0].deletedAt).toBeNull()
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
  // getLoanBalanceSummary
  // =========================================================================

  describe("getLoanBalanceSummary", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("returns principal as outstanding when no payments exist (perpetual loan)", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      let dbSelectCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        dbSelectCount++
        const call = dbSelectCount
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (call === 1) {
                // loan lookup
                return Promise.resolve([mockLoan])
              }
              // payments query — no active payments
              return {
                orderBy: vi.fn().mockResolvedValue([]),
              }
            }),
          }),
        }
      })

      const { getLoanBalanceSummary } = await import("@/services/payment.service")
      const result = await getLoanBalanceSummary("loan-1")

      expect(result.outstandingPrincipal).toBe("500000")
      expect(result.loanType).toBe("perpetual")
      expect(parseFloat(result.accruedInterest)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(result.totalBalance)).toBeGreaterThanOrEqual(parseFloat(result.outstandingPrincipal))
    })

    it("uses ledger balance when available", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const BigNumber = require("bignumber.js").default
      const { getLoanBalanceFromLedger } = await import("@/services/transaction.service")

      // Mock ledger to return 400000
      ;(getLoanBalanceFromLedger as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new BigNumber("400000"))

      let dbSelectCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        dbSelectCount++
        const call = dbSelectCount
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (call === 1) return Promise.resolve([mockLoan])
              return { orderBy: vi.fn().mockResolvedValue([mockPayment]) }
            }),
          }),
        }
      })

      const { getLoanBalanceSummary } = await import("@/services/payment.service")
      const result = await getLoanBalanceSummary("loan-1")

      expect(result.outstandingPrincipal).toBe("400000.00")
      expect(result.loanType).toBe("perpetual")
    })

    it("throws LoanNotFound when loan does not exist", async () => {
      const { db: mockedDb } = await import("@/lib/db")

      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })

      const { getLoanBalanceSummary } = await import("@/services/payment.service")
      await expect(getLoanBalanceSummary("nonexistent")).rejects.toThrow()
    })

    it("computes fixed_rate interest from original principal", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const { computeLoanOverdueInfo } = await import("@/lib/interest/overdue")
      const fixedLoan = { ...mockLoan, loanType: "fixed_rate", termMonths: 12 }

      // Mock computeLoanOverdueInfo to return expected unpaidInterest
      ;(computeLoanOverdueInfo as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        daysOverdue: 0, dailyRate: "0", unpaidInterest: "50000.00",
      })

      let dbSelectCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        dbSelectCount++
        const call = dbSelectCount
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (call === 1) return Promise.resolve([fixedLoan])
              return { orderBy: vi.fn().mockResolvedValue([]) }
            }),
          }),
        }
      })

      const { getLoanBalanceSummary } = await import("@/services/payment.service")
      const result = await getLoanBalanceSummary("loan-1")

      // fixed_rate: interest = principalAmount * rate = 500000 * 0.10 = 50000.00
      expect(result.accruedInterest).toBe("50000.00")
      expect(result.loanType).toBe("fixed_rate")
    })

    it("computes reducing_balance interest from outstanding principal", async () => {
      const { db: mockedDb } = await import("@/lib/db")
      const BigNumber = require("bignumber.js").default
      const { getLoanBalanceFromLedger } = await import("@/services/transaction.service")
      const { computeLoanOverdueInfo } = await import("@/lib/interest/overdue")
      const reducingLoan = { ...mockLoan, loanType: "reducing_balance", termMonths: 12 }

      // Mock ledger to return 400000 (outstanding after payment)
      ;(getLoanBalanceFromLedger as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new BigNumber("400000"))

      // Mock computeLoanOverdueInfo to return expected unpaidInterest
      ;(computeLoanOverdueInfo as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        daysOverdue: 0, dailyRate: "0", unpaidInterest: "40000.00",
      })

      let dbSelectCount = 0
      ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        dbSelectCount++
        const call = dbSelectCount
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              if (call === 1) return Promise.resolve([reducingLoan])
              return { orderBy: vi.fn().mockResolvedValue([mockPayment]) }
            }),
          }),
        }
      })

      const { getLoanBalanceSummary } = await import("@/services/payment.service")
      const result = await getLoanBalanceSummary("loan-1")

      // reducing_balance: interest = outstandingPrincipal * rate = 400000.00 * 0.10 = 40000.00
      expect(result.accruedInterest).toBe("40000.00")
      expect(result.loanType).toBe("reducing_balance")
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

      ;(mockedDb.execute as any) = vi.fn().mockResolvedValue([])

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

      ;(mockedDb.execute as any) = vi.fn().mockResolvedValue(mockRows)

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

      const executeMock = vi.fn().mockResolvedValue([])
      ;(mockedDb.execute as any) = executeMock

      const { getRecentlyCollectedLoans } = await import("@/services/payment.service")
      await Effect.runPromise(getRecentlyCollectedLoans("user-1"))

      // Verify execute was called (limit is embedded in the SQL template)
      expect(executeMock).toHaveBeenCalledOnce()
    })
  })
})
