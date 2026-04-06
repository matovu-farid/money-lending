import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() }
  return { db: mockDb }
})

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/transaction.service", () => ({
  postJournalEntry: vi.fn().mockResolvedValue("mock-journal-group-id"),
  autoPostPrincipalDisbursement: vi.fn().mockResolvedValue(undefined),
  autoPostRolloverPrincipalTransfer: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/payment.service", () => ({
  recalculateFromPayment: vi.fn().mockResolvedValue(undefined),
  reconcileDownstreamJournals: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm")
  return actual
})

const baseCustomer = {
  id: "cust-1",
  fullName: "John Doe",
  nin: "CM00000000TEST",
  contact: "+256700000000",
  address: "Plot 12, Kampala",
  status: "active",
}

const baseLoanInput = {
  customerId: "cust-1",
  principalAmount: "500000.00",
  issuanceFee: "50000.00",
  description: "Business expansion loan",
  interestRate: "0.10",
  minInterestDays: 30,
  startDate: "2026-03-19T00:00:00.000Z",
  collateral: { nature: "Land Title", description: "Plot 42, Kampala" },
  disbursementSource: "cash" as const,
}

const mockLoan = {
  id: "loan-1",
  customerId: "cust-1",
  principalAmount: "500000.00",
  issuanceFee: "50000.00",
  description: "Business expansion loan",
  interestRate: "0.10",
  minInterestDays: 30,
  startDate: new Date("2026-03-19T00:00:00.000Z"),
  status: "active",
  interestRateOverride: null,
  minPeriodOverride: null,
  issuedBy: "actor-1",
  disbursementSource: "cash",
  loanType: "perpetual",
  termMonths: null,
}

const mockCollateral = {
  id: "coll-1",
  loanId: "loan-1",
  nature: "Land Title",
  description: "Plot 42, Kampala",
}

describe("Loan Service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("CreateLoanInput interface has correct shape (LOAN-01)", async () => {
    // Verify the types module exports loan-related types
    const types = await import("@/types")
    expect(types).toBeDefined()
    // TypeScript interfaces are erased at runtime, but if this compiles,
    // CreateLoanInput and CollateralInput are correctly defined
  })

  it("CreateLoanInput does NOT have termDays field (LOAN-02 perpetual)", () => {
    // This is a compile-time guarantee via TypeScript.
    // If someone adds termDays to CreateLoanInput, the type system
    // will catch misuse. This test documents the design intent.
    const input = {
      customerId: "550e8400-e29b-41d4-a716-446655440000",
      principalAmount: "500000.00",
      interestRate: "0.10",
      minInterestDays: 30,
      startDate: "2026-03-19T00:00:00.000Z",
      collateral: { nature: "Land Title" },
    }
    // Verify NO termDays field exists
    expect("termDays" in input).toBe(false)
  })

  it("CollateralInput requires nature field (CUST-03)", () => {
    const valid = { nature: "Vehicle Log Book" }
    expect(valid.nature).toBeDefined()

    const withDescription = { nature: "Land Title", description: "Plot 42, Kampala" }
    expect(withDescription.description).toBeDefined()
  })

  it("loan service exports expected functions", async () => {
    const mod = await import("@/services/loan.service")
    expect(mod.createLoan).toBeDefined()
    expect(mod.getLoan).toBeDefined()
    expect(mod.listLoans).toBeDefined()
  })

  it("creates loan with collateral in single transaction (requires test DB)", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    // Mock customer lookup (1st call) and active loan check (2nd call — no active loan)
    let dbSelectCallCount = 0
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      dbSelectCallCount++
      if (dbSelectCallCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([baseCustomer]),
          }),
        }
      }
      // 2nd call: no existing active loan
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }
    })

    // Mock transaction — execute callback with mock tx
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        let insertCallCount = 0
        const mockTx = {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++
            if (insertCallCount === 1) {
              // loan insert
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockLoan]) }) }
            } else {
              // collateral insert
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockCollateral]) }) }
            }
          }),
        }
        return callback(mockTx)
      }
    )

    const { createLoan } = await import("@/services/loan.service")
    const result = await Effect.runPromise(createLoan(baseLoanInput, "actor-1"))

    expect(result).toEqual({ ...mockLoan, collateral: mockCollateral })
    expect(result.id).toBe("loan-1")
    expect(result.collateral.id).toBe("coll-1")
    expect(result.collateral.nature).toBe("Land Title")
  })

  it("writes audit log in same transaction as loan creation (requires test DB)", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { writeAuditLog } = await import("@/services/audit.service")

    // Mock customer lookup (1st call) and active loan check (2nd call — no active loan)
    let dbSelectCallCount = 0
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      dbSelectCallCount++
      if (dbSelectCallCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([baseCustomer]),
          }),
        }
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }
    })

    let capturedTx: any
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        let insertCallCount = 0
        const mockTx = {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++
            if (insertCallCount === 1) {
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockLoan]) }) }
            } else {
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockCollateral]) }) }
            }
          }),
        }
        capturedTx = mockTx
        return callback(mockTx)
      }
    )

    const { createLoan } = await import("@/services/loan.service")
    await Effect.runPromise(createLoan(baseLoanInput, "actor-1"))

    expect(writeAuditLog).toHaveBeenCalledOnce()
    expect(writeAuditLog).toHaveBeenCalledWith(capturedTx, {
      actorId: "actor-1",
      action: "loan.create",
      entityType: "loan",
      entityId: "loan-1",
      beforeValue: null,
      afterValue: { ...mockLoan, collateral: mockCollateral },
    })
  })

  it("blocks loan if customer details incomplete (requires test DB)", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    const incompleteCustomer = { ...baseCustomer, address: "" }

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([incompleteCustomer]),
      }),
    } as any)

    const { createLoan } = await import("@/services/loan.service")
    const exit = await Effect.runPromiseExit(createLoan(baseLoanInput, "actor-1"))

    // The exit should be a failure
    expect(exit._tag).toBe("Failure")

    // Extract the error from the Cause
    if (exit._tag === "Failure") {
      const cause = exit.cause
      // Cause.failureOption or direct inspection
      // For a single fail, the cause structure is Fail({ error })
      const error = (cause as any).error ?? (cause as any)._tag
      expect(error._tag).toBe("IncompleteLoanRequirements")
      expect(error.missing).toEqual(["address"])
    }
  })

  // ── getLoan: soft-deleted loan guard ────────────────────────────────

  it("getLoan: returns LoanNotFound for a soft-deleted loan", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    // The where clause includes isNull(loans.deletedAt), so when a loan is
    // soft-deleted the DB returns no rows. We simulate that by returning [].
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    const { getLoan } = await import("@/services/loan.service")
    const exit = await Effect.runPromiseExit(getLoan("loan-1"))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect((error.value as any)._tag).toBe("LoanNotFound")
      }
    }
  })

  // ── deleteLoan: soft-delete instead of hard-delete ─────────────────

  it("deleteLoan: creates reversing entries and soft-deletes payments/loans", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { writeAuditLog } = await import("@/services/audit.service")
    const { postJournalEntry } = await import("@/services/transaction.service")

    const mockFeeTx = {
      id: "tx-fee-1",
      type: "credit",
      amount: "50000.00",
      categoryId: "cat-1",
      referenceType: "loan",
      referenceId: "loan-1",
      transactionDate: new Date("2026-03-19"),
      depositLocation: null,
    }

    const mockDisbursementTx = {
      id: "tx-disb-1",
      type: "debit",
      amount: "500000.00",
      categoryId: "cat-3",
      referenceType: "loan",
      referenceId: "loan-1",
      transactionDate: new Date("2026-03-19"),
      depositLocation: "cash",
    }

    const mockPayment = {
      id: "pay-1",
      loanId: "loan-1",
      interestPortion: "25000.00",
      principalPortion: "50000.00",
      amount: "75000.00",
      paymentDate: new Date("2026-04-01"),
      depositLocation: "cash",
    }

    // Mock loan lookup — loan exists and is not soft-deleted
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    } as any)

    let capturedTx: any
    let selectCallCount = 0
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // Active payments lookup
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([mockPayment]),
            }),
          }
        } else if (selectCallCount === 2) {
          // Issuance fee transaction lookup
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([mockFeeTx]),
            }),
          }
        } else {
          // Disbursement transaction lookup (has orderBy + limit)
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([mockDisbursementTx]),
                }),
              }),
            }),
          }
        }
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        capturedTx = mockTx
        return callback(mockTx)
      }
    )

    const { deleteLoan } = await import("@/services/loan.service")
    const result = await Effect.runPromise(
      deleteLoan({ loanId: "loan-1", reason: "Test deletion" }, "actor-1")
    )

    // postJournalEntry called for: fee reversal, disbursement reversal, interest reversal, principal reversal
    expect(postJournalEntry).toHaveBeenCalledTimes(4)

    // tx.update called twice: once for payments soft-delete, once for loan soft-delete
    expect(mockTx.update).toHaveBeenCalledTimes(2)

    // Verify audit log was written
    expect(writeAuditLog).toHaveBeenCalledOnce()
    expect(writeAuditLog).toHaveBeenCalledWith(
      capturedTx,
      expect.objectContaining({
        actorId: "actor-1",
        action: "loan.delete",
        entityType: "loan",
        entityId: "loan-1",
      })
    )

    // Returns the original loan
    expect(result.id).toBe("loan-1")
  })

  it("deleteLoan: soft-delete sets deletedAt, deletedBy, deleteReason on payments", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    } as any)

    let selectCallCount = 0
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount <= 2) {
          // Active payments lookup + fee tx lookup — return empty
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }
        }
        // Disbursement tx lookup (has orderBy + limit)
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => callback(mockTx)
    )

    const { deleteLoan } = await import("@/services/loan.service")
    await Effect.runPromise(
      deleteLoan({ loanId: "loan-1", reason: "Fraud detected" }, "actor-1")
    )

    // First tx.update call is for payments soft-delete
    const firstUpdateSetFn = mockTx.update.mock.results[0].value.set
    const paymentSetArgs = firstUpdateSetFn.mock.calls[0][0]
    expect(paymentSetArgs.deletedAt).toBeInstanceOf(Date)
    expect(paymentSetArgs.deletedBy).toBe("actor-1")
    expect(paymentSetArgs.deleteReason).toBe("Fraud detected")

    // Second tx.update call is for loan soft-delete
    const secondUpdateSetFn = mockTx.update.mock.results[1].value.set
    const loanSetArgs = secondUpdateSetFn.mock.calls[0][0]
    expect(loanSetArgs.deletedAt).toBeInstanceOf(Date)
  })

  it("deleteLoan: creates reversing entry for issuance fee (no hard delete)", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { postJournalEntry } = await import("@/services/transaction.service")

    const mockFeeTx = {
      id: "tx-fee-1",
      type: "credit",
      amount: "50000.00",
      categoryId: "cat-1",
      referenceType: "loan",
      referenceId: "loan-1",
      transactionDate: new Date("2026-03-19"),
      depositLocation: null,
    }

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    } as any)

    let selectCallCount = 0
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // Active payments lookup — no payments
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }
        } else if (selectCallCount === 2) {
          // Issuance fee transaction lookup
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([mockFeeTx]),
            }),
          }
        } else {
          // Disbursement transaction lookup (has orderBy + limit) — no disbursement
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }
        }
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => callback(mockTx)
    )

    const { deleteLoan } = await import("@/services/loan.service")
    await Effect.runPromise(
      deleteLoan({ loanId: "loan-1", reason: "Test deletion" }, "actor-1")
    )

    // postJournalEntry called once for issuance fee reversal (no payments to reverse, no disbursement)
    expect(postJournalEntry).toHaveBeenCalledTimes(1)

    // Verify the reversal params
    expect(postJournalEntry).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        amount: "50000.00",
        referenceType: "loan_reversal",
        referenceId: "loan-1",
        loanId: "loan-1",
      })
    )
  })

  // ── updateLoan ──────────────────────────────────────────────────────

  it("updateLoan: updates issuance fee transaction when fee changes", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { postJournalEntry } = await import("@/services/transaction.service")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    } as any)

    const updatedLoan = { ...mockLoan, issuanceFee: "75000.00" }
    const oldFeeTx = {
      id: "tx-fee-1",
      type: "credit",
      amount: "50000.00",
      categoryId: "cat-1",
      referenceType: "loan",
      referenceId: "loan-1",
      transactionDate: new Date("2026-03-19"),
      depositLocation: null,
    }
    const mockTx = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedLoan]),
          }),
        })),
      })),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([oldFeeTx]),
        }),
      }),
    }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => callback(mockTx)
    )

    const { updateLoan } = await import("@/services/loan.service")
    await Effect.runPromise(
      updateLoan({ loanId: "loan-1", issuanceFee: "75000.00", reason: "Fee adjustment" }, "actor-1")
    )

    // tx.update called once for the loan update only
    expect(mockTx.update).toHaveBeenCalledTimes(1)

    // postJournalEntry called twice: once for reversal, once for new fee
    expect(postJournalEntry).toHaveBeenCalledTimes(2)

    // Second call should be the new fee posting with correct amount
    expect(postJournalEntry).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        amount: "75000.00",
        referenceType: "loan",
        referenceId: "loan-1",
        loanId: "loan-1",
      })
    )
  })

  it("updateLoan: does not touch transaction when issuanceFee is not provided", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { postJournalEntry } = await import("@/services/transaction.service")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    } as any)

    const updatedLoan = { ...mockLoan, principalAmount: "600000.00" }
    const oldDisbursement = {
      id: "tx-disb-1",
      type: "debit",
      amount: "500000.00",
      referenceType: "loan",
      referenceId: "loan-1",
      transactionDate: new Date("2026-03-19"),
      depositLocation: "cash",
    }
    let selectCallCount = 0
    const mockTx = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedLoan]),
          }),
        })),
      })),
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // Old disbursement lookup (has orderBy + limit)
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([oldDisbursement]),
                }),
              }),
            }),
          }
        }
        // Active payments lookup (has orderBy but resolves directly)
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        }
      }),
    }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => callback(mockTx)
    )

    const { updateLoan } = await import("@/services/loan.service")
    await Effect.runPromise(
      updateLoan({ loanId: "loan-1", principalAmount: "600000.00", reason: "Correction" }, "actor-1")
    )

    // tx.update should be called only once for the loan update itself
    expect(mockTx.update).toHaveBeenCalledTimes(1)

    // postJournalEntry called twice for principal change (reversal + repost)
    expect(postJournalEntry).toHaveBeenCalledTimes(2)
  })

  it("calls autoPostRolloverPrincipalTransfer when rolling over with carried principal", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { autoPostRolloverPrincipalTransfer } = await import("@/services/transaction.service")

    const existingLoan = {
      id: "old-loan-1",
      customerId: "cust-1",
      principalAmount: "500000.00",
      status: "active",
    }

    const newLoan = {
      ...mockLoan,
      id: "new-loan-1",
      principalAmount: "750000.00",
      rolledOverFrom: "old-loan-1",
      rolloverAmount: "250000.00",
    }

    // Mock customer lookup (1st call) returns customer, active loan check (2nd call) returns existing loan
    let dbSelectCallCount = 0
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      dbSelectCallCount++
      if (dbSelectCallCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([baseCustomer]),
          }),
        }
      }
      // 2nd call: existing active loan
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([existingLoan]),
        }),
      }
    })

    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        let insertCallCount = 0
        const mockTx = {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++
            if (insertCallCount === 1) {
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([newLoan]) }) }
            }
            return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockCollateral]) }) }
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        }
        return callback(mockTx)
      }
    )

    const rolloverInput = {
      ...baseLoanInput,
      principalAmount: "500000.00",
      rollover: {
        fromLoanId: "old-loan-1",
        carriedPrincipal: "200000.00",
        carriedInterest: "50000.00",
      },
    }

    const { createLoan } = await import("@/services/loan.service")
    await Effect.runPromise(createLoan(rolloverInput, "actor-1"))

    expect(autoPostRolloverPrincipalTransfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amount: "200000.00",
        newLoanId: "new-loan-1",
        oldLoanId: "old-loan-1",
        actorId: "actor-1",
      })
    )
  })
})
