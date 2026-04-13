import { shortId } from "@/lib/utils"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"

vi.mock("@/lib/db", () => {
  const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() }
  return { db: mockDb }
})

vi.mock("@/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/auto-post.service", () => ({
  autoPostRateChangeAdjustment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/interest/effective-rate", () => ({
  getBaseRate: vi.fn().mockReturnValue("0.10"),
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
  interestRateOverride: null,
  status: "active",
  startDate: new Date("2026-03-01"),
  minInterestDays: 30,
  minPeriodOverride: null,
  loanType: "perpetual",
  termMonths: null,
}

const mockRequest = {
  id: "req-1",
  loanId: "loan-1",
  requestedRate: "0.08",
  currentRate: "0.10",
  requestedBy: "user-1",
  requiredApproverRole: "admin",
  status: "pending",
  reviewedBy: null,
  reviewNote: null,
  createdAt: new Date("2026-04-10T10:00:00.000Z"),
  reviewedAt: null,
}

describe("Rate Change Request Service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── createRateChangeRequest ───────────────────────────────────────

  it("creates a rate change request for an existing loan", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    // Mock loan lookup
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockLoan]),
      }),
    })

    // Mock insert
    ;(mockedDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockRequest]),
      }),
    })

    const { createRateChangeRequest } = await import("@/services/rate-change-request.service")
    const result = await Effect.runPromise(
      createRateChangeRequest({ loanId: "loan-1", requestedRate: "0.08" }, "user-1", "admin", "0.10")
    )

    expect(result).toEqual(mockRequest)
    expect(result.status).toBe("pending")
    expect(result.requestedRate).toBe("0.08")
  })

  it("returns LoanNotFound when loan does not exist", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    const { createRateChangeRequest } = await import("@/services/rate-change-request.service")
    const exit = await Effect.runPromiseExit(
      createRateChangeRequest({ loanId: "nonexistent", requestedRate: "0.08" }, "user-1", "admin", "0.10")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("LoanNotFound")
      }
    }
  })

  // ── applyRateChangeImmediately ────────────────────────────────────

  it("applies rate change immediately within a transaction", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { writeAuditLog } = await import("@/services/audit.service")
    const { autoPostRateChangeAdjustment } = await import("@/services/auto-post.service")

    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([mockLoan]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }
        return callback(mockTx)
      }
    )

    const { applyRateChangeImmediately } = await import("@/services/rate-change-request.service")
    await Effect.runPromise(applyRateChangeImmediately("loan-1", "0.08", "actor-1"))

    expect(autoPostRateChangeAdjustment).toHaveBeenCalledOnce()
    expect(writeAuditLog).toHaveBeenCalledOnce()
  })

  it("applyRateChangeImmediately returns LoanNotFound when loan missing", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }
        return callback(mockTx)
      }
    )

    const { applyRateChangeImmediately } = await import("@/services/rate-change-request.service")
    const exit = await Effect.runPromiseExit(applyRateChangeImmediately("missing", "0.08", "actor-1"))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("LoanNotFound")
      }
    }
  })

  // ── listAllRequests ───────────────────────────────────────────────

  it("lists all requests with joined loan/customer data and computed loanRef", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    const dbRow = {
      ...mockRequest,
      customerName: "John Doe",
      principalAmount: "500000",
    }
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([dbRow]),
          }),
        }),
      }),
    })

    const { listAllRequests } = await import("@/services/rate-change-request.service")
    const result = await Effect.runPromise(listAllRequests())

    expect(result).toHaveLength(1)
    expect(result[0].customerName).toBe("John Doe")
    expect(result[0].loanRef).toBe(`LOAN-${shortId(mockRequest.loanId).toUpperCase()}`)
  })

  // ── listRequestsForLoan ───────────────────────────────────────────

  it("lists requests for a specific loan", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([mockRequest]),
        }),
      }),
    })

    const { listRequestsForLoan } = await import("@/services/rate-change-request.service")
    const result = await Effect.runPromise(listRequestsForLoan("loan-1"))

    expect(result).toEqual([mockRequest])
  })

  it("returns empty array when no requests for loan", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    })

    const { listRequestsForLoan } = await import("@/services/rate-change-request.service")
    const result = await Effect.runPromise(listRequestsForLoan("loan-1"))

    expect(result).toEqual([])
  })

  // ── reviewRequest: approve ────────────────────────────────────────

  it("approves a pending request, applies rate to loan, posts adjustment, and writes audit", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { writeAuditLog } = await import("@/services/audit.service")
    const { autoPostRateChangeAdjustment } = await import("@/services/auto-post.service")

    // Mock select to return the pending request
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockRequest]),
      }),
    })

    const updatedRequest = { ...mockRequest, status: "approved", reviewedBy: "reviewer-1", reviewedAt: new Date() }

    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([updatedRequest]),
              }),
            }),
          }),
        }
        return callback(mockTx)
      }
    )

    const { reviewRequest } = await import("@/services/rate-change-request.service")
    const result = await Effect.runPromise(
      reviewRequest({ requestId: "req-1", action: "approved", reviewNote: "Looks good" }, "reviewer-1")
    )

    expect(result.status).toBe("approved")
    expect(autoPostRateChangeAdjustment).toHaveBeenCalledOnce()
    expect(writeAuditLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "loan.rate_change.approved",
      entityType: "loan",
      entityId: "loan-1",
    }))
  })

  // ── reviewRequest: reject ─────────────────────────────────────────

  it("rejects a pending request with audit log but no rate change", async () => {
    const { db: mockedDb } = await import("@/lib/db")
    const { writeAuditLog } = await import("@/services/audit.service")
    const { autoPostRateChangeAdjustment } = await import("@/services/auto-post.service")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockRequest]),
      }),
    })

    const rejectedRequest = { ...mockRequest, status: "rejected", reviewedBy: "reviewer-1" }

    ;(mockedDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (callback: any) => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([rejectedRequest]),
              }),
            }),
          }),
        }
        return callback(mockTx)
      }
    )

    const { reviewRequest } = await import("@/services/rate-change-request.service")
    const result = await Effect.runPromise(
      reviewRequest({ requestId: "req-1", action: "rejected", reviewNote: "Rate too low" }, "reviewer-1")
    )

    expect(result.status).toBe("rejected")
    // Should NOT post rate change adjustment for rejection
    expect(autoPostRateChangeAdjustment).not.toHaveBeenCalled()
    // Should write audit log for rejection
    expect(writeAuditLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "loan.rate_change.rejected",
      entityType: "rate_change_request",
    }))
  })

  // ── reviewRequest: error cases ────────────────────────────────────

  it("returns RateChangeRequestNotFound when request does not exist", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    const { reviewRequest } = await import("@/services/rate-change-request.service")
    const exit = await Effect.runPromiseExit(
      reviewRequest({ requestId: "nonexistent", action: "approved" }, "reviewer-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("RateChangeRequestNotFound")
      }
    }
  })

  it("returns ValidationError when request has already been reviewed", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    const alreadyApproved = { ...mockRequest, status: "approved" }
    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([alreadyApproved]),
      }),
    })

    const { reviewRequest } = await import("@/services/rate-change-request.service")
    const exit = await Effect.runPromiseExit(
      reviewRequest({ requestId: "req-1", action: "approved" }, "reviewer-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("ValidationError")
        expect(error.value.message).toContain("already been reviewed")
      }
    }
  })

  // ── countPendingRequests ──────────────────────────────────────────

  it("returns count of pending requests", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 5 }]),
      }),
    })

    const { countPendingRequests } = await import("@/services/rate-change-request.service")
    const result = await Effect.runPromise(countPendingRequests())

    expect(result).toBe(5)
  })

  it("returns 0 when no pending requests", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    })

    const { countPendingRequests } = await import("@/services/rate-change-request.service")
    const result = await Effect.runPromise(countPendingRequests())

    expect(result).toBe(0)
  })

  it("returns DatabaseError when count query fails", async () => {
    const { db: mockedDb } = await import("@/lib/db")

    ;(mockedDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("DB error")),
      }),
    })

    const { countPendingRequests } = await import("@/services/rate-change-request.service")
    const exit = await Effect.runPromiseExit(countPendingRequests())

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value._tag).toBe("DatabaseError")
      }
    }
  })
})
