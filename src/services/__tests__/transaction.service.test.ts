import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

describe("Transaction Service — DB operations (mocked)", () => {
  let mockedDb: any
  let mockedWriteAuditLog: any

  let recordExpense: any
  let recordIncome: any
  let listTransactions: any
  let getTransactionById: any
  let deleteTransaction: any
  let autoPostInterestEarned: any
  let autoPostInterestExpense: any
  let getPaymentPortionsFromLedger: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const dbMod = await import("@/lib/db")
    mockedDb = dbMod.db as any
    const auditMod = await import("@/services/audit.service")
    mockedWriteAuditLog = auditMod.writeAuditLog as any
    const svc = await import("@/services/transaction.service")
    recordExpense = svc.recordExpense
    recordIncome = svc.recordIncome
    listTransactions = svc.listTransactions
    getTransactionById = svc.getTransactionById
    deleteTransaction = svc.deleteTransaction
    autoPostInterestEarned = svc.autoPostInterestEarned
    autoPostInterestExpense = svc.autoPostInterestExpense
    getPaymentPortionsFromLedger = svc.getPaymentPortionsFromLedger
  })

  // ── helpers ──────────────────────────────────────────────────────────

  const mockTransaction = {
    id: "txn-1",
    type: "debit" as const,
    amount: "50000",
    categoryId: "cat-1",
    referenceType: null,
    referenceId: null,
    description: "Office supplies",
    transactionDate: new Date("2026-03-01"),
    recordedBy: "actor-1",
    createdAt: new Date("2026-03-01"),
  }

  const mockIncomeTransaction = {
    ...mockTransaction,
    id: "txn-2",
    type: "credit" as const,
    amount: "100000",
    categoryId: "cat-2",
    description: "Application fee",
  }

  function makeTxMock(overrides?: { insertResult?: any }) {
    const mockTx: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "cat-cash", name: "Cash", type: "asset", isDefault: true }]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([overrides?.insertResult ?? mockTransaction]),
        }),
      }),
    }
    return mockTx
  }

  function setupTransaction(txMock: any) {
    mockedDb.transaction.mockImplementation(async (cb: any) => cb(txMock))
  }

  function setupDbSelect(rows: any[]) {
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    })
  }

  // ── recordExpense ────────────────────────────────────────────────────

  it("recordExpense: inserts a debit transaction and returns it", async () => {
    const txMock = makeTxMock({ insertResult: mockTransaction })
    setupTransaction(txMock)

    const result = await Effect.runPromise(
      recordExpense(
        {
          categoryId: "cat-1",
          amount: "50000",
          transactionDate: "2026-03-01",
          notes: "Office supplies",
          location: "cash",
        },
        "actor-1"
      )
    )

    expect(result).toEqual(mockTransaction)
    expect(mockedDb.transaction).toHaveBeenCalledOnce()
    expect(txMock.insert).toHaveBeenCalledTimes(2) // debit + credit counterpart
  })

  it("recordExpense: writes audit log in same transaction", async () => {
    const txMock = makeTxMock({ insertResult: mockTransaction })
    setupTransaction(txMock)

    await Effect.runPromise(
      recordExpense(
        {
          categoryId: "cat-1",
          amount: "50000",
          transactionDate: "2026-03-01",
          notes: "Office supplies",
          location: "cash",
        },
        "actor-1"
      )
    )

    expect(mockedWriteAuditLog).toHaveBeenCalledOnce()
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        actorId: "actor-1",
        action: "transaction.create",
        entityType: "transaction",
        entityId: "txn-1",
        beforeValue: null,
        afterValue: mockTransaction,
      })
    )
  })

  it("recordExpense: handles null notes gracefully", async () => {
    const txMock = makeTxMock({
      insertResult: { ...mockTransaction, description: null },
    })
    setupTransaction(txMock)

    const result = await Effect.runPromise(
      recordExpense(
        {
          categoryId: "cat-1",
          amount: "50000",
          transactionDate: "2026-03-01",
          location: "cash",
        },
        "actor-1"
      )
    ) as any

    expect(result.description).toBeNull()
  })

  it("recordExpense: wraps DB errors in DatabaseError", async () => {
    mockedDb.transaction.mockRejectedValue(new Error("connection refused"))

    const exit = await Effect.runPromiseExit(
      recordExpense(
        { categoryId: "cat-1", amount: "50000", transactionDate: "2026-03-01", location: "cash" },
        "actor-1"
      )
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ── recordIncome ─────────────────────────────────────────────────────

  it("recordIncome: inserts a credit transaction and returns it", async () => {
    const txMock = makeTxMock({ insertResult: mockIncomeTransaction })
    setupTransaction(txMock)

    const result = await Effect.runPromise(
      recordIncome(
        {
          categoryId: "cat-2",
          amount: "100000",
          transactionDate: "2026-03-01",
          notes: "Application fee",
          location: "cash",
        },
        "actor-1"
      )
    ) as any

    expect(result).toEqual(mockIncomeTransaction)
    expect(result.type).toBe("credit")
    expect(mockedDb.transaction).toHaveBeenCalledOnce()
  })

  it("recordIncome: writes audit log in same transaction", async () => {
    const txMock = makeTxMock({ insertResult: mockIncomeTransaction })
    setupTransaction(txMock)

    await Effect.runPromise(
      recordIncome(
        {
          categoryId: "cat-2",
          amount: "100000",
          transactionDate: "2026-03-01",
          location: "cash",
        },
        "actor-1"
      )
    )

    expect(mockedWriteAuditLog).toHaveBeenCalledOnce()
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        actorId: "actor-1",
        action: "transaction.create",
        entityType: "transaction",
        entityId: "txn-2",
      })
    )
  })

  // ── getTransactionById ───────────────────────────────────────────────

  it("getTransactionById: returns a transaction by ID", async () => {
    setupDbSelect([mockTransaction])

    const result = await Effect.runPromise(getTransactionById("txn-1")) as any

    expect(result).toEqual(mockTransaction)
    expect(result.id).toBe("txn-1")
  })

  it("getTransactionById: returns TransactionNotFound for non-existent ID", async () => {
    setupDbSelect([])

    const exit = await Effect.runPromiseExit(getTransactionById("nonexistent"))

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect((error.value as any)._tag).toBe("TransactionNotFound")
      }
    }
  })

  // ── deleteTransaction ────────────────────────────────────────────────

  it("deleteTransaction: deletes transaction and writes audit log", async () => {
    setupDbSelect([mockTransaction])

    const txMock: any = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }
    mockedDb.transaction.mockImplementation(async (cb: any) => cb(txMock))

    await Effect.runPromise(deleteTransaction("txn-1", "actor-1"))

    expect(mockedDb.select).toHaveBeenCalled()
    expect(mockedDb.transaction).toHaveBeenCalledOnce()
    expect(txMock.delete).toHaveBeenCalledOnce()
    expect(mockedWriteAuditLog).toHaveBeenCalledOnce()
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        actorId: "actor-1",
        action: "transaction.delete",
        entityType: "transaction",
        entityId: "txn-1",
        beforeValue: mockTransaction,
        afterValue: null,
      })
    )
  })

  it("deleteTransaction: returns TransactionNotFound for non-existent ID", async () => {
    setupDbSelect([])

    const exit = await Effect.runPromiseExit(
      deleteTransaction("nonexistent", "actor-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect((error.value as any)._tag).toBe("TransactionNotFound")
      }
    }
  })

  // ── deleteTransaction: auto-posted guard ────────────────────────────

  it("deleteTransaction: blocks deletion of auto-posted payment transactions", async () => {
    const autoPostedPaymentTxn = {
      ...mockTransaction,
      id: "txn-auto-pay",
      referenceType: "payment",
      referenceId: "pay-1",
    }
    setupDbSelect([autoPostedPaymentTxn])

    const exit = await Effect.runPromiseExit(
      deleteTransaction("txn-auto-pay", "actor-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect((error.value as any)._tag).toBe("TransactionNotFound")
      }
    }
    // Verify no actual deletion happened (transaction was never called)
    expect(mockedDb.transaction).not.toHaveBeenCalled()
  })

  it("deleteTransaction: blocks deletion of auto-posted creditor_repayment transactions", async () => {
    const autoPostedCreditorTxn = {
      ...mockTransaction,
      id: "txn-auto-cred",
      referenceType: "creditor_repayment",
      referenceId: "inv-1",
    }
    setupDbSelect([autoPostedCreditorTxn])

    const exit = await Effect.runPromiseExit(
      deleteTransaction("txn-auto-cred", "actor-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect((error.value as any)._tag).toBe("TransactionNotFound")
      }
    }
    expect(mockedDb.transaction).not.toHaveBeenCalled()
  })

  it("deleteTransaction: allows deletion of manually recorded transactions (no referenceType)", async () => {
    // mockTransaction has referenceType: null — should be deletable
    setupDbSelect([mockTransaction])

    const txMock: any = {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }
    mockedDb.transaction.mockImplementation(async (cb: any) => cb(txMock))

    await Effect.runPromise(deleteTransaction("txn-1", "actor-1"))

    expect(mockedDb.transaction).toHaveBeenCalledOnce()
    expect(txMock.delete).toHaveBeenCalledOnce()
  })

  // ── listTransactions ────────────────────────────────────────────────

  const mockTransactionWithCategory = {
    ...mockTransaction,
    categoryName: "Office Supplies",
  }

  const mockTransactionWithCategory2 = {
    ...mockIncomeTransaction,
    categoryName: "Application Fees",
  }

  function setupListTransactions(rows: any[], total: number) {
    const dataSelect = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(rows),
              }),
            }),
          }),
        }),
      }),
    }

    const countSelect = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: total }]),
        }),
      }),
    }

    mockedDb.select
      .mockReturnValueOnce(dataSelect as any)
      .mockReturnValueOnce(countSelect as any)
  }

  it("listTransactions: returns data and total with empty filters", async () => {
    setupListTransactions([mockTransactionWithCategory, mockTransactionWithCategory2], 2)

    const result = await Effect.runPromise(
      listTransactions({}, 1, 20)
    ) as any

    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(result.data[0]).toEqual(mockTransactionWithCategory)
    expect(mockedDb.select).toHaveBeenCalledTimes(2)
  })

  it("listTransactions: filters by type", async () => {
    setupListTransactions([mockTransactionWithCategory], 1)

    const result = await Effect.runPromise(
      listTransactions({ type: "debit" }, 1, 20)
    ) as any

    expect(result.data).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(result.data[0].type).toBe("debit")
  })

  it("listTransactions: filters by date range", async () => {
    setupListTransactions([mockTransactionWithCategory], 1)

    const result = await Effect.runPromise(
      listTransactions({ dateFrom: "2026-01-01", dateTo: "2026-03-31" }, 1, 20)
    ) as any

    expect(result.data).toHaveLength(1)
    expect(result.total).toBe(1)
  })

  it("listTransactions: paginates correctly for page > 1", async () => {
    setupListTransactions([mockTransactionWithCategory2], 25)

    const result = await Effect.runPromise(
      listTransactions({}, 2, 20)
    ) as any

    // Page 2 with pageSize 20 should still return whatever the mock gives
    expect(result.data).toHaveLength(1)
    expect(result.total).toBe(25)
  })

  it("listTransactions: returns empty data when no transactions match", async () => {
    setupListTransactions([], 0)

    const result = await Effect.runPromise(
      listTransactions({ type: "credit" }, 1, 20)
    ) as any

    expect(result.data).toEqual([])
    expect(result.total).toBe(0)
  })

  it("listTransactions: wraps DB errors in DatabaseError", async () => {
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockRejectedValue(new Error("connection refused")),
              }),
            }),
          }),
        }),
      }),
    })

    const exit = await Effect.runPromiseExit(
      listTransactions({}, 1, 20)
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ── autoPostInterestEarned ───────────────────────────────────────────

  it("autoPostInterestEarned: inserts debit+credit transactions when categories exist", async () => {
    const mockCashCategory = { id: "cat-cash", name: "Cash", type: "asset", isDefault: true }
    const mockInterestCategory = { id: "cat-interest", name: "Interest Earned", type: "revenue", isDefault: true }
    const txMock: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([mockCashCategory])
            .mockResolvedValueOnce([mockInterestCategory]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    }

    await autoPostInterestEarned(txMock, {
      amount: "100000",
      loanId: "loan-1",
      paymentId: "payment-1",
      paymentDate: "2026-03-01",
      actorId: "actor-1",
    })

    expect(txMock.insert).toHaveBeenCalledTimes(2) // debit + credit

    // Verify the debit entry shape
    const debitValuesCall = txMock.insert.mock.results[0].value.values
    expect(debitValuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "debit",
        amount: "100000",
        referenceType: "payment",
        referenceId: "payment-1",
        recordedBy: "actor-1",
        loanId: "loan-1",
      })
    )

    // Verify the credit entry shape
    const creditValuesCall = txMock.insert.mock.results[1].value.values
    expect(creditValuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "credit",
        amount: "100000",
        referenceType: "payment",
        referenceId: "payment-1",
        recordedBy: "actor-1",
        loanId: "loan-1",
      })
    )
  })

  it("autoPostInterestEarned: auto-creates missing categories and still posts entries", async () => {
    const createdCashCat = { id: "cat-cash-new", name: "Cash", type: "asset", isDefault: true }
    const createdInterestCat = { id: "cat-interest-new", name: "Interest Earned", type: "revenue", isDefault: true }
    const txMock: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([]) // Cash not found
            .mockResolvedValueOnce([]), // Interest Earned not found
        }),
      }),
      insert: vi.fn()
        // First call: getOrCreateCategory creates Cash
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([createdCashCat]),
          }),
        })
        // Second call: getOrCreateCategory creates Interest Earned
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([createdInterestCat]),
          }),
        })
        // Third call: debit transaction insert
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValue(undefined),
        })
        // Fourth call: credit transaction insert
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValue(undefined),
        }),
    }

    await autoPostInterestEarned(txMock, {
      amount: "100000",
      loanId: "loan-1",
      paymentId: "payment-1",
      paymentDate: "2026-03-01",
      actorId: "actor-1",
    })

    // 2 category creates + 2 journal entries = 4 inserts
    expect(txMock.insert).toHaveBeenCalledTimes(4)
  })

  // ── autoPostInterestExpense ──────────────────────────────────────────

  it("autoPostInterestExpense: inserts debit+credit transactions when categories exist", async () => {
    const mockInterestExpCat = { id: "cat-interest-exp", name: "Interest Payments", type: "expense", isDefault: true }
    const mockCashCategory = { id: "cat-cash", name: "Cash", type: "asset", isDefault: true }
    const txMock: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([mockInterestExpCat])
            .mockResolvedValueOnce([mockCashCategory]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    }

    await autoPostInterestExpense(txMock, {
      amount: "50000",
      investmentId: "inv-1",
      repaymentDate: "2026-03-01",
      actorId: "actor-1",
    })

    expect(txMock.insert).toHaveBeenCalledTimes(2) // debit + credit

    // Verify the debit entry shape
    const debitValuesCall = txMock.insert.mock.results[0].value.values
    expect(debitValuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "debit",
        amount: "50000",
        referenceType: "creditor_repayment",
        referenceId: "inv-1",
        recordedBy: "actor-1",
      })
    )

    // Verify the credit entry shape
    const creditValuesCall = txMock.insert.mock.results[1].value.values
    expect(creditValuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "credit",
        amount: "50000",
        referenceType: "creditor_repayment",
        referenceId: "inv-1",
        recordedBy: "actor-1",
      })
    )
  })

  it("autoPostInterestExpense: auto-creates missing categories and still posts entries", async () => {
    const createdInterestExpCat = { id: "cat-interest-exp-new", name: "Interest Payments", type: "expense", isDefault: true }
    const createdCashCat = { id: "cat-cash-new", name: "Cash", type: "asset", isDefault: true }
    const txMock: any = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn()
            .mockResolvedValueOnce([]) // Interest Payments not found
            .mockResolvedValueOnce([]), // Cash not found
        }),
      }),
      insert: vi.fn()
        // First call: getOrCreateCategory creates Interest Payments
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([createdInterestExpCat]),
          }),
        })
        // Second call: getOrCreateCategory creates Cash
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([createdCashCat]),
          }),
        })
        // Third call: debit transaction insert
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValue(undefined),
        })
        // Fourth call: credit transaction insert
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValue(undefined),
        }),
    }

    await autoPostInterestExpense(txMock, {
      amount: "50000",
      investmentId: "inv-1",
      repaymentDate: "2026-03-01",
      actorId: "actor-1",
    })

    // 2 category creates + 2 journal entries = 4 inserts
    expect(txMock.insert).toHaveBeenCalledTimes(4)
  })

  // ── getPaymentPortionsFromLedger ─────────────────────────────────────

  function setupLedgerPortionsSelect(rows: any[]) {
    mockedDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    })
  }

  it("getPaymentPortionsFromLedger: returns empty map for empty input", async () => {
    const result = await getPaymentPortionsFromLedger([])
    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
    expect(mockedDb.select).not.toHaveBeenCalled()
  })

  it("getPaymentPortionsFromLedger: derives interest and principal portions for a single payment", async () => {
    setupLedgerPortionsSelect([
      { referenceId: "pay-1", categoryName: "Interest Earned", txType: "credit", total: "5000.00" },
      { referenceId: "pay-1", categoryName: "Loans Receivable", txType: "credit", total: "45000.00" },
    ])

    const result = await getPaymentPortionsFromLedger(["pay-1"])

    expect(result.size).toBe(1)
    const portions = result.get("pay-1")
    expect(portions).toBeDefined()
    expect(portions!.interestPortion).toBe("5000.00")
    expect(portions!.principalPortion).toBe("45000.00")
  })

  it("getPaymentPortionsFromLedger: handles multiple payments in a single query", async () => {
    setupLedgerPortionsSelect([
      { referenceId: "pay-1", categoryName: "Interest Earned", txType: "credit", total: "3000.00" },
      { referenceId: "pay-1", categoryName: "Loans Receivable", txType: "credit", total: "27000.00" },
      { referenceId: "pay-2", categoryName: "Interest Earned", txType: "credit", total: "2500.00" },
      { referenceId: "pay-2", categoryName: "Loans Receivable", txType: "credit", total: "22500.00" },
    ])

    const result = await getPaymentPortionsFromLedger(["pay-1", "pay-2"])

    expect(result.size).toBe(2)
    expect(result.get("pay-1")!.interestPortion).toBe("3000.00")
    expect(result.get("pay-1")!.principalPortion).toBe("27000.00")
    expect(result.get("pay-2")!.interestPortion).toBe("2500.00")
    expect(result.get("pay-2")!.principalPortion).toBe("22500.00")
  })

  it("getPaymentPortionsFromLedger: subtracts DR entries for Interest Earned (reversal)", async () => {
    setupLedgerPortionsSelect([
      { referenceId: "pay-1", categoryName: "Interest Earned", txType: "credit", total: "5000.00" },
      { referenceId: "pay-1", categoryName: "Interest Earned", txType: "debit", total: "5000.00" },
      { referenceId: "pay-1", categoryName: "Loans Receivable", txType: "credit", total: "45000.00" },
    ])

    const result = await getPaymentPortionsFromLedger(["pay-1"])

    const portions = result.get("pay-1")
    expect(portions!.interestPortion).toBe("0.00")
    expect(portions!.principalPortion).toBe("45000.00")
  })

  it("getPaymentPortionsFromLedger: subtracts DR entries for Loans Receivable (disbursement row)", async () => {
    // DR Loans Receivable means asset increase (disbursement) — should subtract from principal portion
    setupLedgerPortionsSelect([
      { referenceId: "pay-1", categoryName: "Loans Receivable", txType: "credit", total: "45000.00" },
      { referenceId: "pay-1", categoryName: "Loans Receivable", txType: "debit", total: "5000.00" },
    ])

    const result = await getPaymentPortionsFromLedger(["pay-1"])

    const portions = result.get("pay-1")
    expect(portions!.principalPortion).toBe("40000.00")
    expect(portions!.interestPortion).toBe("0.00")
  })

  it("getPaymentPortionsFromLedger: returns string values with 2 decimal places", async () => {
    setupLedgerPortionsSelect([
      { referenceId: "pay-1", categoryName: "Interest Earned", txType: "credit", total: "1000" },
      { referenceId: "pay-1", categoryName: "Loans Receivable", txType: "credit", total: "9000" },
    ])

    const result = await getPaymentPortionsFromLedger(["pay-1"])

    const portions = result.get("pay-1")
    expect(portions!.interestPortion).toBe("1000.00")
    expect(portions!.principalPortion).toBe("9000.00")
  })

  it("getPaymentPortionsFromLedger: skips rows with null referenceId", async () => {
    setupLedgerPortionsSelect([
      { referenceId: null, categoryName: "Interest Earned", txType: "credit", total: "5000.00" },
    ])

    const result = await getPaymentPortionsFromLedger(["pay-1"])

    expect(result.size).toBe(0)
  })
})
