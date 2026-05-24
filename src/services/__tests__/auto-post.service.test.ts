import { describe, it, expect, vi, beforeEach } from "vitest"
import type { DrizzleTx } from "./_test-helpers"

type InsertedTransaction = Record<string, unknown>

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

const mockPostJournalEntry = vi.fn().mockResolvedValue("journal-group-id")
const mockReverseInterestAccrual = vi.fn().mockResolvedValue(undefined)

vi.mock("@/services/transaction.service", () => ({
  postJournalEntry: mockPostJournalEntry,
  reverseInterestAccrual: mockReverseInterestAccrual,
}))

vi.mock("crypto", () => ({
  randomUUID: () => "mock-uuid-1234",
}))

describe("Auto-Post Service", () => {
  const mockTxImpl = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "cat-id-1", name: "Loans Receivable", type: "asset", isDefault: true }]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "cat-id-1", name: "Loans Receivable", type: "asset" }]),
        }),
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  }

  const mockTx = mockTxImpl as unknown as DrizzleTx

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock chain for tx
    mockTxImpl.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "cat-id-1", name: "Loans Receivable", type: "asset", isDefault: true }]),
      }),
    })
    mockTxImpl.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "cat-id-1" }]),
        }),
        returning: vi.fn().mockResolvedValue([]),
      }),
    })
  })

  // ── autoPostInterestEarned ──────────────────────────────────────────

  describe("autoPostInterestEarned", () => {
    it("posts journal entry with Cash debit and Interest Earned credit", async () => {
      const { autoPostInterestEarned } = await import("@/services/auto-post.service")
      await autoPostInterestEarned(mockTx, {
        amount: "50000",
        loanId: "loan-1",
        paymentId: "pay-1",
        paymentDate: "2026-04-01",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).toHaveBeenCalledOnce()
      expect(mockPostJournalEntry).toHaveBeenCalledWith(mockTx, {
        debitCategory: { name: "Cash", type: "asset" },
        creditCategory: { name: "Interest Earned", type: "revenue" },
        amount: "50000",
        referenceType: "payment",
        referenceId: "pay-1",
        description: "Interest earned - loan loan-1 payment pay-1",
        transactionDate: new Date("2026-04-01"),
        recordedBy: "actor-1",
        debitDepositLocation: undefined,
        loanId: "loan-1",
      })
    })

    it("passes depositLocation as debitDepositLocation", async () => {
      const { autoPostInterestEarned } = await import("@/services/auto-post.service")
      await autoPostInterestEarned(mockTx, {
        amount: "50000",
        loanId: "loan-1",
        paymentId: "pay-1",
        paymentDate: "2026-04-01",
        actorId: "actor-1",
        depositLocation: "bank",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.debitDepositLocation).toBe("bank")
    })

    it("passes depositLocation strong_room correctly", async () => {
      const { autoPostInterestEarned } = await import("@/services/auto-post.service")
      await autoPostInterestEarned(mockTx, {
        amount: "75000",
        loanId: "loan-2",
        paymentId: "pay-2",
        paymentDate: "2026-04-05",
        actorId: "actor-2",
        depositLocation: "strong_room",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.debitDepositLocation).toBe("strong_room")
    })
  })

  // ── autoPostInterestExpense ─────────────────────────────────────────

  describe("autoPostInterestExpense", () => {
    it("posts journal entry with Interest Payments debit and Cash credit", async () => {
      const { autoPostInterestExpense } = await import("@/services/auto-post.service")
      await autoPostInterestExpense(mockTx, {
        amount: "30000",
        investmentId: "inv-1",
        repaymentId: "rep-1",
        repaymentDate: "2026-04-01",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).toHaveBeenCalledOnce()
      expect(mockPostJournalEntry).toHaveBeenCalledWith(mockTx, {
        debitCategory: { name: "Interest Payments", type: "expense" },
        creditCategory: { name: "Cash", type: "asset" },
        amount: "30000",
        referenceType: "creditor_repayment",
        referenceId: "rep-1",
        description: "Interest paid - investment inv-1",
        transactionDate: new Date("2026-04-01"),
        recordedBy: "actor-1",
        creditDepositLocation: undefined,
      })
    })

    it("uses investmentId as referenceId when repaymentId is absent", async () => {
      const { autoPostInterestExpense } = await import("@/services/auto-post.service")
      await autoPostInterestExpense(mockTx, {
        amount: "30000",
        investmentId: "inv-1",
        repaymentDate: "2026-04-01",
        actorId: "actor-1",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.referenceId).toBe("inv-1")
    })

    it("passes sourceLocation as creditDepositLocation", async () => {
      const { autoPostInterestExpense } = await import("@/services/auto-post.service")
      await autoPostInterestExpense(mockTx, {
        amount: "30000",
        investmentId: "inv-1",
        repaymentDate: "2026-04-01",
        actorId: "actor-1",
        sourceLocation: "cash",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.creditDepositLocation).toBe("cash")
    })
  })

  // ── autoPostPrincipalDisbursement ───────────────────────────────────

  describe("autoPostPrincipalDisbursement", () => {
    it("posts journal entry with Loans Receivable debit and Cash credit", async () => {
      const { autoPostPrincipalDisbursement } = await import("@/services/auto-post.service")
      await autoPostPrincipalDisbursement(mockTx, {
        amount: "1000000",
        loanId: "abcd1234-5678-9abc-def0-123456789abc",
        transactionDate: "2026-04-01",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).toHaveBeenCalledOnce()
      expect(mockPostJournalEntry).toHaveBeenCalledWith(mockTx, {
        debitCategory: { name: "Loans Receivable", type: "asset" },
        creditCategory: { name: "Cash", type: "asset" },
        amount: "1000000",
        referenceType: "loan",
        referenceId: "abcd1234-5678-9abc-def0-123456789abc",
        description: "Principal disbursed - loan ABCD1234",
        transactionDate: new Date("2026-04-01"),
        recordedBy: "actor-1",
        creditDepositLocation: undefined,
        loanId: "abcd1234-5678-9abc-def0-123456789abc",
      })
    })

    it("passes depositLocation as creditDepositLocation", async () => {
      const { autoPostPrincipalDisbursement } = await import("@/services/auto-post.service")
      await autoPostPrincipalDisbursement(mockTx, {
        amount: "500000",
        loanId: "abcd1234-0000-0000-0000-000000000000",
        transactionDate: "2026-04-01",
        actorId: "actor-1",
        depositLocation: "bank",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.creditDepositLocation).toBe("bank")
    })

    it("formats loanId slice as uppercase in description", async () => {
      const { autoPostPrincipalDisbursement } = await import("@/services/auto-post.service")
      await autoPostPrincipalDisbursement(mockTx, {
        amount: "500000",
        loanId: "deadbeef-0000-0000-0000-000000000000",
        transactionDate: "2026-04-01",
        actorId: "actor-1",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.description).toBe("Principal disbursed - loan DEADBEEF")
    })
  })

  // ── autoPostRolloverPrincipalTransfer ───────────────────────────────

  describe("autoPostRolloverPrincipalTransfer", () => {
    it("inserts debit and credit entries using tx.insert directly", async () => {
      const insertValues: InsertedTransaction[] = []
      const localTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: "cat-lr-id", name: "Loans Receivable", type: "asset" }]),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation((vals: InsertedTransaction) => {
            insertValues.push(vals)
            return {
              onConflictDoNothing: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: "cat-lr-id" }]),
              }),
              returning: vi.fn().mockResolvedValue([]),
            }
          }),
        }),
      }

      const { autoPostRolloverPrincipalTransfer } = await import("@/services/auto-post.service")
      await autoPostRolloverPrincipalTransfer(localTx as unknown as DrizzleTx, {
        amount: "500000",
        newLoanId: "new-loan-1234-5678-9abc-000000000000",
        oldLoanId: "old-loan-abcd-efgh-ijkl-000000000000",
        transactionDate: new Date("2026-04-01"),
        actorId: "actor-1",
      })

      // Does NOT call postJournalEntry
      expect(mockPostJournalEntry).not.toHaveBeenCalled()

      // Two insert calls: debit then credit
      expect(localTx.insert).toHaveBeenCalledTimes(2)
      expect(insertValues).toHaveLength(2)

      // Debit entry (new loan)
      const debit = insertValues[0]
      expect(debit.type).toBe("debit")
      expect(debit.amount).toBe("500000")
      expect(debit.categoryId).toBe("cat-lr-id")
      expect(debit.referenceType).toBe("rollover")
      expect(debit.referenceId).toBe("old-loan-abcd-efgh-ijkl-000000000000")
      expect(debit.loanId).toBe("new-loan-1234-5678-9abc-000000000000")
      expect(debit.description).toBe("Principal carried from loan OLD-LOAN")
      expect(debit.recordedBy).toBe("actor-1")
      expect(debit.journalGroupId).toBe("mock-uuid-1234")

      // Credit entry (old loan)
      const credit = insertValues[1]
      expect(credit.type).toBe("credit")
      expect(credit.amount).toBe("500000")
      expect(credit.categoryId).toBe("cat-lr-id")
      expect(credit.referenceType).toBe("rollover")
      expect(credit.referenceId).toBe("new-loan-1234-5678-9abc-000000000000")
      expect(credit.loanId).toBe("old-loan-abcd-efgh-ijkl-000000000000")
      expect(credit.description).toBe("Principal transferred to loan NEW-LOAN")
      expect(credit.recordedBy).toBe("actor-1")
      expect(credit.journalGroupId).toBe("mock-uuid-1234")
    })

    it("uses getOrCreateCategory with Loans Receivable / asset", async () => {
      const whereFn = vi.fn().mockResolvedValue([{ id: "existing-cat-id" }])
      const localTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: whereFn,
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }

      const { autoPostRolloverPrincipalTransfer } = await import("@/services/auto-post.service")
      await autoPostRolloverPrincipalTransfer(localTx as unknown as DrizzleTx, {
        amount: "100000",
        newLoanId: "new-loan-0000-0000-0000-000000000000",
        oldLoanId: "old-loan-0000-0000-0000-000000000000",
        transactionDate: new Date("2026-04-01"),
        actorId: "actor-1",
      })

      // select was called to look up the category
      expect(localTx.select).toHaveBeenCalled()
    })

    it("shares the same journalGroupId across both entries", async () => {
      const insertValues: InsertedTransaction[] = []
      const localTx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: "cat-id" }]),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation((vals: InsertedTransaction) => {
            insertValues.push(vals)
            return { returning: vi.fn().mockResolvedValue([]) }
          }),
        }),
      }

      const { autoPostRolloverPrincipalTransfer } = await import("@/services/auto-post.service")
      await autoPostRolloverPrincipalTransfer(localTx as unknown as DrizzleTx, {
        amount: "200000",
        newLoanId: "new-loan-0000-0000-0000-000000000000",
        oldLoanId: "old-loan-0000-0000-0000-000000000000",
        transactionDate: new Date("2026-04-01"),
        actorId: "actor-1",
      })

      expect(insertValues[0].journalGroupId).toBe(insertValues[1].journalGroupId)
    })
  })

  // ── autoPostPrincipalRepayment ──────────────────────────────────────

  describe("autoPostPrincipalRepayment", () => {
    it("posts journal entry with Cash debit and Loans Receivable credit", async () => {
      const { autoPostPrincipalRepayment } = await import("@/services/auto-post.service")
      await autoPostPrincipalRepayment(mockTx, {
        amount: "200000",
        loanId: "abcd1234-0000-0000-0000-000000000000",
        paymentId: "deadbeef-0000-0000-0000-000000000000",
        paymentDate: "2026-04-01",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).toHaveBeenCalledOnce()
      expect(mockPostJournalEntry).toHaveBeenCalledWith(mockTx, {
        debitCategory: { name: "Cash", type: "asset" },
        creditCategory: { name: "Loans Receivable", type: "asset" },
        amount: "200000",
        referenceType: "payment",
        referenceId: "deadbeef-0000-0000-0000-000000000000",
        description: "Principal repaid - loan ABCD1234 payment DEADBEEF",
        transactionDate: new Date("2026-04-01"),
        recordedBy: "actor-1",
        debitDepositLocation: undefined,
        loanId: "abcd1234-0000-0000-0000-000000000000",
      })
    })

    it("passes depositLocation as debitDepositLocation", async () => {
      const { autoPostPrincipalRepayment } = await import("@/services/auto-post.service")
      await autoPostPrincipalRepayment(mockTx, {
        amount: "200000",
        loanId: "abcd1234-0000-0000-0000-000000000000",
        paymentId: "deadbeef-0000-0000-0000-000000000000",
        paymentDate: "2026-04-01",
        actorId: "actor-1",
        depositLocation: "strong_room",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.debitDepositLocation).toBe("strong_room")
    })
  })

  // ── autoPostPrincipalRecovery ───────────────────────────────────────

  describe("autoPostPrincipalRecovery", () => {
    it("posts journal entry with Seized Collateral debit and Loans Receivable credit", async () => {
      const { autoPostPrincipalRecovery } = await import("@/services/auto-post.service")
      await autoPostPrincipalRecovery(mockTx, {
        amount: "300000",
        loanId: "abcd1234-0000-0000-0000-000000000000",
        transactionDate: "2026-04-01",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).toHaveBeenCalledOnce()
      expect(mockPostJournalEntry).toHaveBeenCalledWith(mockTx, {
        debitCategory: { name: "Seized Collateral", type: "asset" },
        creditCategory: { name: "Loans Receivable", type: "asset" },
        amount: "300000",
        referenceType: "collateral_settlement",
        referenceId: "abcd1234-0000-0000-0000-000000000000",
        description: "Principal recovered via collateral - loan ABCD1234",
        transactionDate: new Date("2026-04-01"),
        recordedBy: "actor-1",
        loanId: "abcd1234-0000-0000-0000-000000000000",
      })
    })
  })

  // ── autoPostCreditorInvestment ──────────────────────────────────────

  describe("autoPostCreditorInvestment", () => {
    it("posts journal entry with Cash debit and Creditor Investment credit", async () => {
      const { autoPostCreditorInvestment } = await import("@/services/auto-post.service")
      await autoPostCreditorInvestment(mockTx, {
        amount: "5000000",
        investmentId: "abcd1234-0000-0000-0000-000000000000",
        investmentDate: "2026-04-01",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).toHaveBeenCalledOnce()
      expect(mockPostJournalEntry).toHaveBeenCalledWith(mockTx, {
        debitCategory: { name: "Cash", type: "asset" },
        creditCategory: { name: "Creditor Investment", type: "liability" },
        amount: "5000000",
        referenceType: "creditor_investment",
        referenceId: "abcd1234-0000-0000-0000-000000000000",
        description: "Creditor investment received - ABCD1234",
        transactionDate: new Date("2026-04-01"),
        recordedBy: "actor-1",
        debitDepositLocation: undefined,
      })
    })

    it("passes depositLocation as debitDepositLocation", async () => {
      const { autoPostCreditorInvestment } = await import("@/services/auto-post.service")
      await autoPostCreditorInvestment(mockTx, {
        amount: "5000000",
        investmentId: "abcd1234-0000-0000-0000-000000000000",
        investmentDate: "2026-04-01",
        actorId: "actor-1",
        depositLocation: "bank",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.debitDepositLocation).toBe("bank")
    })
  })

  // ── autoPostCreditorPrincipalRepaid ─────────────────────────────────

  describe("autoPostCreditorPrincipalRepaid", () => {
    it("posts journal entry with Creditor Investment debit and Cash credit", async () => {
      const { autoPostCreditorPrincipalRepaid } = await import("@/services/auto-post.service")
      await autoPostCreditorPrincipalRepaid(mockTx, {
        amount: "2000000",
        investmentId: "abcd1234-0000-0000-0000-000000000000",
        repaymentId: "rep-1",
        repaymentDate: "2026-04-01",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).toHaveBeenCalledOnce()
      expect(mockPostJournalEntry).toHaveBeenCalledWith(mockTx, {
        debitCategory: { name: "Creditor Investment", type: "liability" },
        creditCategory: { name: "Cash", type: "asset" },
        amount: "2000000",
        referenceType: "creditor_repayment",
        referenceId: "rep-1",
        description: "Creditor principal repaid - investment ABCD1234",
        transactionDate: new Date("2026-04-01"),
        recordedBy: "actor-1",
        creditDepositLocation: undefined,
      })
    })

    it("uses investmentId as referenceId when repaymentId is absent", async () => {
      const { autoPostCreditorPrincipalRepaid } = await import("@/services/auto-post.service")
      await autoPostCreditorPrincipalRepaid(mockTx, {
        amount: "2000000",
        investmentId: "inv-fallback",
        repaymentDate: "2026-04-01",
        actorId: "actor-1",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.referenceId).toBe("inv-fallback")
    })

    it("passes sourceLocation as creditDepositLocation", async () => {
      const { autoPostCreditorPrincipalRepaid } = await import("@/services/auto-post.service")
      await autoPostCreditorPrincipalRepaid(mockTx, {
        amount: "2000000",
        investmentId: "inv-1",
        repaymentDate: "2026-04-01",
        actorId: "actor-1",
        sourceLocation: "strong_room",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.creditDepositLocation).toBe("strong_room")
    })
  })

  // ── autoPostRateChangeAdjustment ────────────────────────────────────

  describe("autoPostRateChangeAdjustment", () => {
    it("calls reverseInterestAccrual with correct params", async () => {
      const { autoPostRateChangeAdjustment } = await import("@/services/auto-post.service")

      const beforeDate = new Date()
      await autoPostRateChangeAdjustment(mockTx, {
        loanId: "loan-1",
        oldRate: "10",
        newRate: "15",
        actorId: "actor-1",
      })
      const afterDate = new Date()

      expect(mockReverseInterestAccrual).toHaveBeenCalledOnce()
      expect(mockReverseInterestAccrual).toHaveBeenCalledWith(mockTx, {
        loanId: "loan-1",
        paymentDate: expect.any(String),
        actorId: "actor-1",
      })

      // Verify the paymentDate is a valid ISO string within the test window
      const passedDate = new Date(mockReverseInterestAccrual.mock.calls[0][1].paymentDate)
      expect(passedDate.getTime()).toBeGreaterThanOrEqual(beforeDate.getTime())
      expect(passedDate.getTime()).toBeLessThanOrEqual(afterDate.getTime())
    })

    it("does NOT call postJournalEntry", async () => {
      const { autoPostRateChangeAdjustment } = await import("@/services/auto-post.service")
      await autoPostRateChangeAdjustment(mockTx, {
        loanId: "loan-1",
        oldRate: "10",
        newRate: "15",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).not.toHaveBeenCalled()
    })
  })

  // ── autoPostFundTransfer ────────────────────────────────────────────

  describe("autoPostFundTransfer", () => {
    it("posts journal entry with Cash debit and Cash credit with correct locations", async () => {
      const { autoPostFundTransfer } = await import("@/services/auto-post.service")
      await autoPostFundTransfer(mockTx, {
        amount: "1000000",
        transferId: "tf-1",
        fromLocation: "cash",
        toLocation: "bank",
        transactionDate: "2026-04-01",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).toHaveBeenCalledOnce()
      expect(mockPostJournalEntry).toHaveBeenCalledWith(mockTx, {
        debitCategory: { name: "Cash", type: "asset" },
        creditCategory: { name: "Cash", type: "asset" },
        amount: "1000000",
        referenceType: "fund_transfer",
        referenceId: "tf-1",
        description: "Fund transfer from cash to bank",
        transactionDate: new Date("2026-04-01"),
        recordedBy: "actor-1",
        debitDepositLocation: "bank",
        creditDepositLocation: "cash",
      })
    })

    it("maps toLocation to debitDepositLocation and fromLocation to creditDepositLocation", async () => {
      const { autoPostFundTransfer } = await import("@/services/auto-post.service")
      await autoPostFundTransfer(mockTx, {
        amount: "500000",
        transferId: "tf-2",
        fromLocation: "strong_room",
        toLocation: "cash",
        transactionDate: "2026-04-01",
        actorId: "actor-1",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.debitDepositLocation).toBe("cash")
      expect(call.creditDepositLocation).toBe("strong_room")
    })
  })

  // ── autoPostCapitalInjection ────────────────────────────────────────

  describe("autoPostCapitalInjection", () => {
    it("posts journal entry with Cash debit and Share Capital credit", async () => {
      const { autoPostCapitalInjection } = await import("@/services/auto-post.service")
      await autoPostCapitalInjection(mockTx, {
        amount: "10000000",
        transferId: "cap-1",
        toLocation: "bank",
        transactionDate: "2026-04-01",
        actorId: "actor-1",
      })

      expect(mockPostJournalEntry).toHaveBeenCalledOnce()
      expect(mockPostJournalEntry).toHaveBeenCalledWith(mockTx, {
        debitCategory: { name: "Cash", type: "asset" },
        creditCategory: { name: "Share Capital", type: "equity" },
        amount: "10000000",
        referenceType: "capital_injection",
        referenceId: "cap-1",
        description: "Capital injection to bank",
        transactionDate: new Date("2026-04-01"),
        recordedBy: "actor-1",
        debitDepositLocation: "bank",
      })
    })

    it("passes toLocation as debitDepositLocation", async () => {
      const { autoPostCapitalInjection } = await import("@/services/auto-post.service")
      await autoPostCapitalInjection(mockTx, {
        amount: "5000000",
        transferId: "cap-2",
        toLocation: "strong_room",
        transactionDate: "2026-04-01",
        actorId: "actor-1",
      })

      const call = mockPostJournalEntry.mock.calls[0][1]
      expect(call.debitDepositLocation).toBe("strong_room")
    })
  })
})
