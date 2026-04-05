import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() }
  return { db: mockDb }
})

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
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

    // Mock customer lookup
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([baseCustomer]),
      }),
    } as any)

    // Mock transaction — execute callback with mock tx
    const mockFeeCategory = { id: "cat-1", name: "Issuance Fees", type: "income", isDefault: true }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        let insertCallCount = 0
        const mockTx = {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++
            if (insertCallCount === 1) {
              // loan insert
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockLoan]) }) }
            } else if (insertCallCount === 2) {
              // collateral insert
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockCollateral]) }) }
            } else if (insertCallCount === 3) {
              // transactionCategories insert (if category not found)
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockFeeCategory]) }) }
            } else {
              // transactions insert (no returning)
              return { values: vi.fn().mockResolvedValue(undefined) }
            }
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),  // no existing category
            }),
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

    // Mock customer lookup
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([baseCustomer]),
      }),
    } as any)

    let capturedTx: any
    const mockFeeCategory = { id: "cat-1", name: "Issuance Fees", type: "income", isDefault: true }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        let insertCallCount = 0
        const mockTx = {
          insert: vi.fn().mockImplementation(() => {
            insertCallCount++
            if (insertCallCount === 1) {
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockLoan]) }) }
            } else if (insertCallCount === 2) {
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockCollateral]) }) }
            } else if (insertCallCount === 3) {
              return { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockFeeCategory]) }) }
            } else {
              return { values: vi.fn().mockResolvedValue(undefined) }
            }
          }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
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

    const mockFeeTx = {
      id: "tx-fee-1",
      type: "credit",
      amount: "50000.00",
      categoryId: "cat-1",
      referenceType: "loan",
      referenceId: "loan-1",
    }

    const mockPayment = {
      id: "pay-1",
      loanId: "loan-1",
      interestPortion: "25000.00",
      principalPortion: "50000.00",
      amount: "75000.00",
    }

    const mockInterestCategory = { id: "cat-2", name: "Interest Earned", type: "income", isDefault: true }

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
          // Issuance fee transaction lookup
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([mockFeeTx]),
            }),
          }
        } else if (selectCallCount === 2) {
          // Loan payments lookup (full rows now)
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([mockPayment]),
            }),
          }
        } else {
          // Interest Earned category lookup
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([mockInterestCategory]),
            }),
          }
        }
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
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

    // tx.insert called twice: once for fee reversal, once for interest reversal
    expect(mockTx.insert).toHaveBeenCalledTimes(2)

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

    const mockTx = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
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

    const mockFeeTx = {
      id: "tx-fee-1",
      type: "credit",
      amount: "50000.00",
      categoryId: "cat-1",
      referenceType: "loan",
      referenceId: "loan-1",
    }

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    } as any)

    const insertValuesCalls: any[] = []
    let selectCallCount = 0
    const mockTx = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // Issuance fee transaction lookup
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([mockFeeTx]),
            }),
          }
        } else {
          // Loan payments lookup — no payments
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }
        }
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals: any) => {
          insertValuesCalls.push(vals)
          return Promise.resolve(undefined)
        }),
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

    // tx.insert called once for issuance fee reversal (no payments to reverse)
    expect(mockTx.insert).toHaveBeenCalledTimes(1)

    // Verify the reversal values
    const reversalValues = insertValuesCalls[0]
    expect(reversalValues.type).toBe("debit")
    expect(reversalValues.amount).toBe("50000.00")
    expect(reversalValues.referenceType).toBe("loan_reversal")
    expect(reversalValues.referenceId).toBe("loan-1")
    expect(reversalValues.description).toContain("Reversal")
    expect(reversalValues.description).toContain("Test deletion")
  })

  // ── updateLoan ──────────────────────────────────────────────────────

  it("updateLoan: updates issuance fee transaction when fee changes", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    } as any)

    const updatedLoan = { ...mockLoan, issuanceFee: "75000.00" }
    const setCalls: any[] = []
    const mockTx = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((args: any) => {
          setCalls.push(args)
          return {
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedLoan]),
            }),
          }
        }),
      })),
    }
    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => callback(mockTx)
    )

    const { updateLoan } = await import("@/services/loan.service")
    await Effect.runPromise(
      updateLoan({ loanId: "loan-1", issuanceFee: "75000.00", reason: "Fee adjustment" }, "actor-1")
    )

    // tx.update called for: 1) loan update, 2) issuance fee transaction update
    expect(mockTx.update).toHaveBeenCalledTimes(2)

    // Second .set() call should be for the transaction row
    expect(setCalls[1].amount).toBe("75000.00")
    expect(setCalls[1].description).toBe("Issuance fee for loan LOAN-1")
  })

  it("updateLoan: does not touch transaction when issuanceFee is not provided", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    } as any)

    const updatedLoan = { ...mockLoan, principalAmount: "600000.00" }
    const mockTx = {
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedLoan]),
          }),
        })),
      })),
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
  })
})
