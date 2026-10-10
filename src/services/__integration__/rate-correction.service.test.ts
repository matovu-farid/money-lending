import { beforeEach, describe, expect, it } from "vitest"
import { Cause, Effect, Exit } from "effect"
import { eq, sql } from "drizzle-orm"
import { resetDb, testDb } from "./setup"
import {
  applyAdminRateAdjustment,
  createPendingRateChangeRequest,
  createRateChangeRequest,
  reviewRequest,
} from "@/services/rate-change-request.service"
import { customers } from "@/lib/db/schema/customers"
import { loans } from "@/lib/db/schema/loans"
import { payments } from "@/lib/db/schema/payments"
import { loanWaivers } from "@/lib/db/schema/loan-waivers"
import { auditLog } from "@/lib/db/schema/audit"
import { rateChangeRequests } from "@/lib/db/schema/rate-change-requests"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { postJournalEntry, accrueInterestForLoans, reverseInterestAccrual } from "@/services/transaction.service"
import { getInterestEarnedFromLedger } from "@/services/ledger-queries.service"
import { buildLoanStatement } from "@/lib/loan-statement"
import { computeSingleLoanBalanceData } from "@/lib/interest/loanBalanceData"
import { recordPayment } from "@/services/payment.service"
import BigNumber from "bignumber.js"

async function makeLoan(loanType: "perpetual" | "fixed_rate" | "reducing_balance" = "perpetual") {
  const [customer] = await testDb.insert(customers).values({
    fullName: "Rate Correction Test",
    nin: "C0000000000000",
    contact: "+256700000000",
    address: "Kampala",
  }).returning()
  const [loan] = await testDb.insert(loans).values({
    customerId: customer.id,
    principalAmount: "1000000.00",
    issuanceFee: "0.00",
    interestRate: "0.1000",
    minInterestDays: 30,
    startDate: new Date("2026-02-21T00:00:00.000Z"),
    status: "active",
    issuedBy: "integration-test-actor",
    disbursementSource: "cash",
    loanType,
    termMonths: loanType === "perpetual" ? null : 6,
  }).returning()
  return loan
}

async function expectBlocked(loanId: string, reason: string) {
  const result = await Effect.runPromiseExit(applyAdminRateAdjustment({
    loanId,
    newRate: "0.0800",
    actorId: "admin-1",
  }))
  expect(Exit.isFailure(result)).toBe(true)
  if (Exit.isFailure(result)) {
    const failure = Cause.failureOption(result.cause)
    expect(failure._tag).toBe("Some")
    if (failure._tag === "Some") {
      expect(failure.value._tag).toBe("ValidationError")
      expect(failure.value.message).toContain(reason)
    }
  }
  const [loan] = await testDb.select().from(loans).where(eq(loans.id, loanId))
  expect(loan.interestRateOverride).toBeNull()
  const audit = await testDb.select().from(auditLog).where(eq(auditLog.entityId, loanId))
  expect(audit).toHaveLength(0)
}

describe("permanent rate-correction locks", () => {
  beforeEach(async () => {
    await resetDb()
    await testDb.insert(transactionCategories).values([
      { id: "00000000-0000-4000-a000-000000000001", name: "Interest Receivable", type: "revenue", isDefault: true },
      { id: "00000000-0000-4000-a000-000000000002", name: "Interest Earned", type: "revenue", isDefault: true },
    ])
  })

  it("records that an eligible correction applies from the loan's start date", async () => {
    const loan = await makeLoan()
    await Effect.runPromise(applyAdminRateAdjustment({
      loanId: loan.id,
      newRate: "0.0800",
      actorId: "admin-1",
    }))
    const [persisted] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    expect(persisted.interestRateOverride).toBe("0.0800")
    const [audit] = await testDb.select().from(auditLog).where(eq(auditLog.entityId, loan.id))
    expect(JSON.parse(audit.afterValue ?? "null")).toMatchObject({
      interestRateOverride: "0.0800",
      rateSemantics: "correction",
      effectiveFrom: loan.startDate.toISOString(),
    })
  })

  it.each(["0.00001", "0.10004"])("rejects a rate that becomes invalid or unchanged at four decimals: %s", async (newRate) => {
    const loan = await makeLoan()
    const result = await Effect.runPromiseExit(applyAdminRateAdjustment({
      loanId: loan.id, newRate, actorId: "admin-1",
    }))
    expect(Exit.isFailure(result)).toBe(true)
    const [persisted] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    expect(persisted.interestRateOverride).toBeNull()
    expect(await testDb.select().from(auditLog).where(eq(auditLog.entityId, loan.id))).toHaveLength(0)
    expect(await testDb.select().from(transactions).where(eq(transactions.loanId, loan.id))).toHaveLength(0)
  })

  it("rejects invalid and unchanged pending requests before storing them", async () => {
    const loan = await makeLoan()
    for (const requestedRate of ["0.00001", "0.10004", "1.0000"]) {
      await expect(createPendingRateChangeRequest({
        loanId: loan.id, requestedRate, currentRate: "0.1000",
        requestedBy: "integration-test-actor", requiredApproverRole: "rate-change:approve-standard",
      })).rejects.toMatchObject({ _tag: "ValidationError" })
    }
    expect(await testDb.select().from(rateChangeRequests)).toHaveLength(0)
  })

  it("rejects a pending request based on a stale pre-lock rate snapshot", async () => {
    const loan = await makeLoan()
    await expect(createPendingRateChangeRequest({
      loanId: loan.id, requestedRate: "0.0800", currentRate: "0.0900",
      requestedBy: "integration-test-actor", requiredApproverRole: "rate-change:approve-standard",
    })).rejects.toMatchObject({ _tag: "ValidationError", message: expect.stringContaining("changed") })
    expect(await testDb.select().from(rateChangeRequests)).toHaveLength(0)
  })

  it.each(["perpetual", "fixed_rate", "reducing_balance"] as const)(
    "applies a backdated correction consistently to %s loan accrual",
    async (loanType) => {
      const loan = await makeLoan(loanType)
      await Effect.runPromise(applyAdminRateAdjustment({
        loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
      }))
      const [corrected] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
      const statement = buildLoanStatement({ loan: corrected, payments: [], today: new Date() })
      expect(statement.terms.baseRate).toBe("0.0800")
      expect(statement.events.some((event) => event.kind === "rate_changed")).toBe(false)
      const earned = (await getInterestEarnedFromLedger([loan.id])).get(loan.id)
      expect(earned?.toFixed(0)).toBe(statement.finalState.cumulativeInterestAccrued)
    },
  )

  it.each(["fixed_rate", "reducing_balance"] as const)(
    "does not count %s non-cash accrued interest as borrower-paid interest",
    async (loanType) => {
      const loan = await makeLoan(loanType)
      await testDb.insert(transactionCategories).values([
        { id: "00000000-0000-4000-a000-000000000003", name: "Cash", type: "asset", isDefault: true },
        { id: "00000000-0000-4000-a000-000000000004", name: "Loans Receivable", type: "asset", isDefault: true },
      ])
      await testDb.transaction((tx) => postJournalEntry(tx, {
        debitCategory: { name: "Loans Receivable", type: "asset" },
        creditCategory: { name: "Cash", type: "asset" },
        amount: loan.principalAmount,
        referenceType: "loan", referenceId: loan.id, loanId: loan.id,
        description: "Test disbursement", transactionDate: loan.startDate,
        recordedBy: "integration-test-actor",
      }))
      await Effect.runPromise(applyAdminRateAdjustment({
        loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
      }))
      const asOf = new Date()
      const [corrected] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
      const statement = buildLoanStatement({ loan: corrected, payments: [], today: asOf })
      const balance = await computeSingleLoanBalanceData(loan.id, asOf)
      expect(Number(statement.finalState.netUnpaidInterest)).toBeGreaterThan(100000)
      expect(balance.unpaidInterest).toBe(statement.finalState.netUnpaidInterest)
      expect(new BigNumber(balance.totalBalanceOwed).plus(balance.unpaidInterest).toFixed(0))
        .toBe(statement.finalState.totalDue)
    },
  )

  it.each(["perpetual", "fixed_rate"] as const)(
    "refuses to guess a corrected %s balance when a payment has no ledger allocation",
    async (loanType) => {
      const loan = await makeLoan(loanType)
      await Effect.runPromise(applyAdminRateAdjustment({
        loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
      }))
      await testDb.insert(payments).values({
        loanId: loan.id, paymentDate: new Date(), amount: "1000.00",
        recordedBy: "integration-test-actor", depositLocation: "cash",
      })
      await expect(computeSingleLoanBalanceData(loan.id, new Date()))
        .rejects.toThrow("unreconciled settlement allocation")
    },
  )

  it("keeps fractional-payment total due equal to the corrected statement", async () => {
    const loan = await makeLoan("fixed_rate")
    const startDate = new Date("2026-07-01T00:00:00.000Z")
    const paymentDate = new Date("2026-10-01T00:00:00.000Z")
    await testDb.update(loans).set({ startDate }).where(eq(loans.id, loan.id))
    await testDb.insert(transactionCategories).values([
      { id: "00000000-0000-4000-a000-000000000003", name: "Cash", type: "asset", isDefault: true },
      { id: "00000000-0000-4000-a000-000000000004", name: "Loans Receivable", type: "asset", isDefault: true },
    ])
    await testDb.transaction((tx) => postJournalEntry(tx, {
      debitCategory: { name: "Loans Receivable", type: "asset" },
      creditCategory: { name: "Cash", type: "asset" },
      amount: "1000000.00", referenceType: "loan", referenceId: loan.id,
      loanId: loan.id, description: "Test disbursement", transactionDate: startDate,
      recordedBy: "integration-test-actor",
    }))
    await Effect.runPromise(applyAdminRateAdjustment({
      loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
    }))
    const [payment] = await testDb.insert(payments).values({
      loanId: loan.id, paymentDate, amount: "100000.49",
      recordedBy: "integration-test-actor", depositLocation: "cash",
    }).returning()
    await testDb.transaction((tx) => postJournalEntry(tx, {
      debitCategory: { name: "Cash", type: "asset" },
      creditCategory: { name: "Interest Earned", type: "revenue" },
      amount: "100000.49", referenceType: "payment", referenceId: payment.id,
      loanId: loan.id, description: "Fractional interest payment", transactionDate: paymentDate,
      recordedBy: "integration-test-actor",
    }))
    const [corrected] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    const statement = buildLoanStatement({
      loan: corrected, payments: [{
        paymentDate, amount: "100000.49", interestPortion: "100000.49",
        principalPortion: "0.00", recorderName: "",
      }], today: paymentDate,
    })
    const balance = await computeSingleLoanBalanceData(loan.id, paymentDate)
    expect(balance.unpaidInterest).toBe(statement.finalState.netUnpaidInterest)
    expect(new BigNumber(balance.totalBalanceOwed).plus(balance.unpaidInterest).toFixed(0))
      .toBe(statement.finalState.totalDue)
  })

  it("fully settles a corrected loan and records only true excess as overpayment", async () => {
    const loan = await makeLoan()
    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await testDb.update(loans).set({ startDate }).where(eq(loans.id, loan.id))
    await testDb.insert(transactionCategories).values([
      { id: "00000000-0000-4000-a000-000000000003", name: "Cash", type: "asset", isDefault: true },
      { id: "00000000-0000-4000-a000-000000000004", name: "Loans Receivable", type: "asset", isDefault: true },
    ])
    await testDb.transaction((tx) => postJournalEntry(tx, {
      debitCategory: { name: "Loans Receivable", type: "asset" },
      creditCategory: { name: "Cash", type: "asset" }, amount: "1000000.00",
      referenceType: "loan", referenceId: loan.id, loanId: loan.id,
      description: "Test disbursement", transactionDate: startDate,
      recordedBy: "integration-test-actor",
    }))
    await Effect.runPromise(applyAdminRateAdjustment({
      loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
    }))
    const payment = await Effect.runPromise(recordPayment({
      loanId: loan.id, paymentDate: new Date().toISOString(), amount: "1180000.00",
      depositLocation: "cash",
    }, "integration-test-actor"))
    expect(payment.allocation.overpaymentAmount).toBe("100000.00")
    const [persisted] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    expect(persisted.status).toBe("fully_paid")
  })

  it("allows a successor's own rate to be corrected before its first lock event", async () => {
    const predecessor = await makeLoan()
    const [successor] = await testDb.insert(loans).values({
      customerId: predecessor.customerId,
      principalAmount: "1100000.00", issuanceFee: "0.00", interestRate: "0.1000",
      minInterestDays: 30, startDate: new Date("2026-03-21T00:00:00.000Z"),
      status: "active", issuedBy: "integration-test-actor", disbursementSource: "cash",
      loanType: "perpetual", rolledOverFrom: predecessor.id,
    }).returning()
    await Effect.runPromise(applyAdminRateAdjustment({
      loanId: successor.id, newRate: "0.0800", actorId: "admin-1",
    }))
    const [persisted] = await testDb.select().from(loans).where(eq(loans.id, successor.id))
    expect(persisted.interestRateOverride).toBe("0.0800")
  })

  it("keeps accruing a corrected rollover successor with carried predecessor interest", async () => {
    const predecessor = await makeLoan()
    await testDb.update(loans).set({ status: "rolled_over" }).where(eq(loans.id, predecessor.id))
    const [successor] = await testDb.insert(loans).values({
      customerId: predecessor.customerId,
      principalAmount: "1100000.00", issuanceFee: "0.00", interestRate: "0.1000",
      minInterestDays: 30, startDate: new Date("2026-03-21T00:00:00.000Z"),
      status: "active", issuedBy: "integration-test-actor", disbursementSource: "cash",
      loanType: "perpetual", rolledOverFrom: predecessor.id,
    }).returning()
    await testDb.insert(transactionCategories).values({
      id: "00000000-0000-4000-a000-000000000004", name: "Loans Receivable", type: "asset", isDefault: true,
    })
    await testDb.transaction((tx) => postJournalEntry(tx, {
      debitCategory: { name: "Loans Receivable", type: "asset" },
      creditCategory: { name: "Interest Earned", type: "revenue" },
      amount: "100000.00", referenceType: "rollover", referenceId: predecessor.id,
      loanId: successor.id, description: "Predecessor interest carried into successor",
      transactionDate: successor.startDate, recordedBy: "integration-test-actor",
    }))
    await Effect.runPromise(applyAdminRateAdjustment({
      loanId: successor.id, newRate: "0.0800", actorId: "admin-1",
    }))
    const asOf = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const [corrected] = await testDb.select().from(loans).where(eq(loans.id, successor.id))
    const target = new BigNumber(buildLoanStatement({ loan: corrected, payments: [], today: asOf })
      .finalState.cumulativeInterestAccrued).plus("100000")
    await Effect.runPromise(accrueInterestForLoans(asOf))
    expect((await getInterestEarnedFromLedger([successor.id])).get(successor.id)?.toFixed(0))
      .toBe(target.toFixed(0))
    const firstRows = await testDb.select().from(transactions).where(eq(transactions.loanId, successor.id))
    await Effect.runPromise(accrueInterestForLoans(asOf))
    const secondRows = await testDb.select().from(transactions).where(eq(transactions.loanId, successor.id))
    expect(secondRows).toHaveLength(firstRows.length)
  })

  it("approved requests use the same retroactive correction semantics", async () => {
    const loan = await makeLoan()
    const request = await createPendingRateChangeRequest({
      loanId: loan.id,
      requestedRate: "0.0800",
      currentRate: "0.1000",
      requestedBy: "integration-test-actor",
      requiredApproverRole: "admin",
    })
    await Effect.runPromise(reviewRequest({ requestId: request.id, action: "approved" }, "admin-1"))
    const [audit] = await testDb.select().from(auditLog).where(eq(auditLog.entityId, loan.id))
    expect(JSON.parse(audit.afterValue ?? "null")).toMatchObject({
      interestRateOverride: "0.0800",
      requestId: request.id,
      rateSemantics: "correction",
      effectiveFrom: loan.startDate.toISOString(),
    })
  })

  it("reconciles posted non-cash accrual to corrected statement interest immediately", async () => {
    const loan = await makeLoan()
    await testDb.transaction((tx) => postJournalEntry(tx, {
      debitCategory: { name: "Interest Receivable", type: "revenue" },
      creditCategory: { name: "Interest Earned", type: "revenue" },
      amount: "300000.00",
      referenceType: "interest_accrual",
      referenceId: loan.id,
      loanId: loan.id,
      description: "Prior non-cash interest accrual",
      transactionDate: new Date("2026-07-01T00:00:00.000Z"),
      recordedBy: "system",
    }))
    const original = await testDb.select().from(transactions).where(eq(transactions.loanId, loan.id))

    await Effect.runPromise(applyAdminRateAdjustment({
      loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
    }))

    const [correctedLoan] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    const target = buildLoanStatement({ loan: correctedLoan, payments: [], today: new Date() })
      .finalState.cumulativeInterestAccrued
    const rows = await testDb.select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      categoryName: transactionCategories.name,
      journalGroupId: transactions.journalGroupId,
    }).from(transactions).innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
      .where(eq(transactions.loanId, loan.id))
    const netReceivable = rows.filter((row) => row.categoryName === "Interest Receivable")
      .reduce((sum, row) => sum.plus(row.type === "debit" ? row.amount : `-${row.amount}`), new BigNumber(0))
    expect(netReceivable.toFixed(0)).toBe(target)
    expect(rows).toHaveLength(4)
    expect(rows.some((row) => row.categoryName === "Cash")).toBe(false)
    expect(original.every((row) => rows.some((after) => after.id === row.id))).toBe(true)
    const groups = Map.groupBy(rows, (row) => row.journalGroupId)
    expect([...groups.values()].every((group) => group.length === 2 && group[0].amount === group[1].amount)).toBe(true)
  })

  it("links each non-cash correction journal to its own applied audit", async () => {
    const loan = await makeLoan()
    await Effect.runPromise(applyAdminRateAdjustment({
      loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
    }))
    await Effect.runPromise(applyAdminRateAdjustment({
      loanId: loan.id, newRate: "0.0700", actorId: "admin-1",
    }))
    const audits = await testDb.select().from(auditLog).where(eq(auditLog.entityId, loan.id))
    const correctionIds = audits.map((audit) => JSON.parse(audit.afterValue ?? "null").correctionId as string)
    expect(correctionIds).toHaveLength(2)
    expect(correctionIds[0]).toBeTruthy()
    expect(correctionIds[1]).toBeTruthy()
    expect(correctionIds[0]).not.toBe(correctionIds[1])
    const journalRows = await testDb.select().from(transactions).where(eq(transactions.loanId, loan.id))
    for (const id of correctionIds) {
      expect(journalRows.filter((row) => row.description?.includes(id))).toHaveLength(2)
    }
  })

  it("preserves the original disbursement cash journal exactly", async () => {
    const loan = await makeLoan()
    await testDb.insert(transactionCategories).values([
      { id: "00000000-0000-4000-a000-000000000003", name: "Cash", type: "asset", isDefault: true },
      { id: "00000000-0000-4000-a000-000000000004", name: "Loans Receivable", type: "asset", isDefault: true },
    ])
    await testDb.transaction((tx) => postJournalEntry(tx, {
      debitCategory: { name: "Loans Receivable", type: "asset" },
      creditCategory: { name: "Cash", type: "asset" },
      amount: loan.principalAmount, referenceType: "loan", referenceId: loan.id,
      loanId: loan.id, description: "Disbursement", transactionDate: loan.startDate,
      recordedBy: "integration-test-actor",
    }))
    const cashBefore = await testDb.select({
      id: transactions.id, amount: transactions.amount, type: transactions.type,
      referenceId: transactions.referenceId,
    }).from(transactions).innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
      .where(eq(transactionCategories.name, "Cash"))

    await Effect.runPromise(applyAdminRateAdjustment({
      loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
    }))

    const cashAfter = await testDb.select({
      id: transactions.id, amount: transactions.amount, type: transactions.type,
      referenceId: transactions.referenceId,
    }).from(transactions).innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
      .where(eq(transactionCategories.name, "Cash"))
    expect(cashAfter).toEqual(cashBefore)
  })

  it("reduces over-posted interest without editing old journals or touching cash", async () => {
    const loan = await makeLoan()
    await testDb.transaction((tx) => postJournalEntry(tx, {
      debitCategory: { name: "Interest Receivable", type: "revenue" },
      creditCategory: { name: "Interest Earned", type: "revenue" },
      amount: "900000.00", referenceType: "interest_accrual", referenceId: loan.id,
      loanId: loan.id, description: "Prior accrual", transactionDate: new Date(), recordedBy: "system",
    }))
    const original = await testDb.select().from(transactions).where(eq(transactions.loanId, loan.id))
    await Effect.runPromise(applyAdminRateAdjustment({ loanId: loan.id, newRate: "0.0800", actorId: "admin-1" }))
    const rows = await testDb.select({
      id: transactions.id, type: transactions.type, amount: transactions.amount,
      categoryName: transactionCategories.name,
    }).from(transactions).innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
      .where(eq(transactions.loanId, loan.id))
    expect(rows).toHaveLength(4)
    expect(original.every((row) => rows.some((after) => after.id === row.id))).toBe(true)
    expect(rows.some((row) => row.categoryName === "Cash")).toBe(false)
    const [correctedLoan] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    const target = buildLoanStatement({ loan: correctedLoan, payments: [], today: new Date() })
      .finalState.cumulativeInterestAccrued
    const netReceivable = rows.filter((row) => row.categoryName === "Interest Receivable")
      .reduce((sum, row) => sum.plus(row.type === "debit" ? row.amount : `-${row.amount}`), new BigNumber(0))
    expect(netReceivable.toFixed(0)).toBe(target)
    expect(rows.some((row) => row.categoryName === "Interest Receivable" && row.type === "credit")).toBe(true)
  })

  it("rolls back the whole correction when prior accrual journals are unpaired", async () => {
    const loan = await makeLoan()
    await testDb.insert(transactions).values({
      type: "debit", amount: "1000.00",
      categoryId: "00000000-0000-4000-a000-000000000001",
      referenceType: "interest_accrual", referenceId: loan.id, loanId: loan.id,
      description: "Broken accrual", transactionDate: new Date(), recordedBy: "system",
    })
    const result = await Effect.runPromiseExit(applyAdminRateAdjustment({
      loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
    }))
    expect(Exit.isFailure(result)).toBe(true)
    const [persisted] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    expect(persisted.interestRateOverride).toBeNull()
    expect(await testDb.select().from(auditLog).where(eq(auditLog.entityId, loan.id))).toHaveLength(0)
    expect(await testDb.select().from(transactions).where(eq(transactions.loanId, loan.id))).toHaveLength(1)
  })

  it("does not let the next accrual worker re-add pre-penalty interest", async () => {
    const loan = await makeLoan()
    await Effect.runPromise(applyAdminRateAdjustment({ loanId: loan.id, newRate: "0.0800", actorId: "admin-1" }))
    const asOf = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    await Effect.runPromise(accrueInterestForLoans(asOf))
    const [correctedLoan] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    const target = buildLoanStatement({ loan: correctedLoan, payments: [], today: asOf })
      .finalState.cumulativeInterestAccrued
    const rows = await testDb.select({
      type: transactions.type, amount: transactions.amount, categoryName: transactionCategories.name,
    }).from(transactions).innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
      .where(eq(transactions.loanId, loan.id))
    const netReceivable = rows.filter((row) => row.categoryName === "Interest Receivable")
      .reduce((sum, row) => sum.plus(row.type === "debit" ? row.amount : `-${row.amount}`), new BigNumber(0))
    expect(netReceivable.toFixed(0)).toBe(target)
  })

  it("keeps accrual reversals attributed to the loan for future earned-interest totals", async () => {
    const loan = await makeLoan()
    await testDb.transaction((tx) => postJournalEntry(tx, {
      debitCategory: { name: "Interest Receivable", type: "revenue" },
      creditCategory: { name: "Interest Earned", type: "revenue" },
      amount: "100000.00", referenceType: "interest_accrual", referenceId: loan.id,
      loanId: loan.id, description: "Accrual before payment", transactionDate: new Date(), recordedBy: "system",
    }))
    await testDb.transaction((tx) => reverseInterestAccrual(tx, {
      loanId: loan.id, paymentDate: new Date().toISOString(), actorId: "integration-test-actor",
    }))

    const rows = await testDb.select().from(transactions).where(eq(transactions.referenceId, loan.id))
    const reversals = rows.filter((row) => row.description?.startsWith("Reverse interest accrual on payment"))
    expect(reversals).toHaveLength(2)
    expect(reversals.every((row) => row.loanId === loan.id)).toBe(true)
    expect((await getInterestEarnedFromLedger([loan.id])).get(loan.id)?.toFixed(2)).toBe("0.00")
  })

  it("reaccrues the correct amount after a payment on a previously corrected loan", async () => {
    const loan = await makeLoan()
    await testDb.insert(transactionCategories).values({
      id: "00000000-0000-4000-a000-000000000003", name: "Cash", type: "asset", isDefault: true,
    })
    await Effect.runPromise(applyAdminRateAdjustment({ loanId: loan.id, newRate: "0.0800", actorId: "admin-1" }))
    const paymentDate = new Date()
    const [payment] = await testDb.insert(payments).values({
      loanId: loan.id, paymentDate, amount: "50000.00",
      recordedBy: "integration-test-actor", depositLocation: "cash",
    }).returning()
    await testDb.transaction(async (tx) => {
      await reverseInterestAccrual(tx, {
        loanId: loan.id, paymentDate: paymentDate.toISOString(), actorId: "integration-test-actor",
      })
      await postJournalEntry(tx, {
        debitCategory: { name: "Cash", type: "asset" },
        creditCategory: { name: "Interest Earned", type: "revenue" },
        amount: "50000.00", referenceType: "payment", referenceId: payment.id,
        loanId: loan.id, description: "Interest paid", transactionDate: paymentDate,
        recordedBy: "integration-test-actor",
      })
    })
    const asOf = new Date(paymentDate.getTime() + 2 * 24 * 60 * 60 * 1000)
    await Effect.runPromise(accrueInterestForLoans(asOf))
    const [correctedLoan] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    const target = buildLoanStatement({
      loan: correctedLoan,
      payments: [{ paymentDate, amount: "50000.00", interestPortion: "50000.00", principalPortion: "0.00", recorderName: "" }],
      today: asOf,
    }).finalState.cumulativeInterestAccrued
    const earned = (await getInterestEarnedFromLedger([loan.id])).get(loan.id)
    expect(earned?.toFixed(0)).toBe(target)
    const beforeRepeat = await testDb.select().from(transactions).where(eq(transactions.loanId, loan.id))
    await Effect.runPromise(accrueInterestForLoans(asOf))
    const afterRepeat = await testDb.select().from(transactions).where(eq(transactions.loanId, loan.id))
    expect(afterRepeat).toHaveLength(beforeRepeat.length)
  })

  it("locks after a payment even when the payment was marked wrong and deleted", async () => {
    const loan = await makeLoan()
    await testDb.insert(payments).values({
      loanId: loan.id,
      paymentDate: new Date("2026-03-01T00:00:00.000Z"),
      amount: "10000.00",
      recordedBy: "integration-test-actor",
      depositLocation: "cash",
      markedWrong: true,
      deletedAt: new Date("2026-03-02T00:00:00.000Z"),
    })
    await expectBlocked(loan.id, "payment")
  })

  it("cannot pass the eligibility check while a competing payment holds the loan lock", async () => {
    const loan = await makeLoan()
    let competingCorrection: Promise<Exit.Exit<void, unknown>> | undefined
    await testDb.transaction(async (tx) => {
      await tx.select({ id: loans.id }).from(loans).where(eq(loans.id, loan.id)).for("update")
      competingCorrection = Effect.runPromiseExit(applyAdminRateAdjustment({
        loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
      }))
      const deadline = Date.now() + 5000
      let waiting = false
      while (Date.now() < deadline) {
        const [activity] = await testDb.execute(sql`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock' AND query ILIKE '%loans%'
        `)
        waiting = Number(activity?.waiting ?? 0) > 0
        if (waiting) break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(waiting).toBe(true)
      await tx.insert(payments).values({
        loanId: loan.id, paymentDate: new Date(), amount: "1000.00",
        recordedBy: "integration-test-actor", depositLocation: "cash",
      })
    })
    expect(competingCorrection).toBeDefined()
    const result = await competingCorrection!
    expect(Exit.isFailure(result)).toBe(true)
    const [persisted] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    expect(persisted.interestRateOverride).toBeNull()
  })

  it.each(["waiver", "rollover"] as const)(
    "cannot pass the eligibility check while a competing %s holds the loan lock",
    async (kind) => {
      const loan = await makeLoan()
      let competingCorrection: Promise<Exit.Exit<void, unknown>> | undefined
      await testDb.transaction(async (tx) => {
        await tx.select({ id: loans.id }).from(loans).where(eq(loans.id, loan.id)).for("update")
        competingCorrection = Effect.runPromiseExit(applyAdminRateAdjustment({
          loanId: loan.id, newRate: "0.0800", actorId: "admin-1",
        }))
        const deadline = Date.now() + 5000
        let waiting = false
        while (Date.now() < deadline) {
          const [activity] = await testDb.execute(sql`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query ILIKE '%loans%'
          `)
          waiting = Number(activity?.waiting ?? 0) > 0
          if (waiting) break
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        expect(waiting).toBe(true)
        if (kind === "waiver") {
          await tx.insert(loanWaivers).values({
            loanId: loan.id, amount: "1000.00", waiverDate: new Date(),
            reason: "Concurrent waiver", recordedBy: "integration-test-actor",
          })
        } else {
          await tx.insert(loans).values({
            customerId: loan.customerId, principalAmount: "1000000.00",
            issuanceFee: "0.00", interestRate: "0.1000", minInterestDays: 30,
            startDate: new Date(), status: "active", issuedBy: "integration-test-actor",
            disbursementSource: "cash", rolledOverFrom: loan.id,
          })
        }
      })
      const result = await competingCorrection!
      expect(Exit.isFailure(result)).toBe(true)
      const [persisted] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
      expect(persisted.interestRateOverride).toBeNull()
      expect(await testDb.select().from(auditLog).where(eq(auditLog.entityId, loan.id))).toHaveLength(0)
    },
  )

  it("locks after a waiver even when the waiver was undone", async () => {
    const loan = await makeLoan()
    await testDb.insert(loanWaivers).values({
      loanId: loan.id,
      amount: "10000.00",
      waiverDate: new Date("2026-03-01T00:00:00.000Z"),
      reason: "Test waiver",
      recordedBy: "integration-test-actor",
      deletedAt: new Date("2026-03-02T00:00:00.000Z"),
    })
    await expectBlocked(loan.id, "waiver")
  })

  it("locks a predecessor even when its successor was deleted", async () => {
    const predecessor = await makeLoan()
    await testDb.insert(loans).values({
      customerId: predecessor.customerId,
      principalAmount: "1000000.00",
      issuanceFee: "0.00",
      interestRate: "0.1000",
      minInterestDays: 30,
      startDate: new Date("2026-03-01T00:00:00.000Z"),
      status: "active",
      issuedBy: "integration-test-actor",
      disbursementSource: "cash",
      rolledOverFrom: predecessor.id,
      deletedAt: new Date("2026-03-02T00:00:00.000Z"),
    })
    await expectBlocked(predecessor.id, "rollover")
  })

  it("rejects a pending request created after a payment", async () => {
    const loan = await makeLoan()
    await testDb.insert(payments).values({
      loanId: loan.id,
      paymentDate: new Date("2026-03-01T00:00:00.000Z"),
      amount: "10000.00",
      recordedBy: "integration-test-actor",
      depositLocation: "cash",
    })
    await expect(createPendingRateChangeRequest({
      loanId: loan.id,
      requestedRate: "0.0800",
      currentRate: "0.1000",
      requestedBy: "integration-test-actor",
      requiredApproverRole: "admin",
    })).rejects.toMatchObject({ _tag: "ValidationError", message: expect.stringContaining("payment") })
    expect(await testDb.select().from(rateChangeRequests)).toHaveLength(0)
  })

  it("does not let the legacy request entry point bypass the payment lock", async () => {
    const loan = await makeLoan()
    await testDb.insert(payments).values({
      loanId: loan.id,
      paymentDate: new Date("2026-03-01T00:00:00.000Z"),
      amount: "10000.00",
      recordedBy: "integration-test-actor",
      depositLocation: "cash",
    })
    const result = await Effect.runPromiseExit(createRateChangeRequest(
      { loanId: loan.id, requestedRate: "0.0800" },
      "integration-test-actor", "admin", "0.1000",
    ))
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const failure = Cause.failureOption(result.cause)
      expect(failure._tag).toBe("Some")
      if (failure._tag === "Some") expect(failure.value._tag).toBe("ValidationError")
    }
    expect(await testDb.select().from(rateChangeRequests)).toHaveLength(0)
  })

  it("rechecks eligibility when approving a request made before a payment", async () => {
    const loan = await makeLoan()
    const request = await createPendingRateChangeRequest({
      loanId: loan.id,
      requestedRate: "0.0800",
      currentRate: "0.1000",
      requestedBy: "integration-test-actor",
      requiredApproverRole: "admin",
    })
    await testDb.insert(payments).values({
      loanId: loan.id,
      paymentDate: new Date("2026-03-01T00:00:00.000Z"),
      amount: "10000.00",
      recordedBy: "integration-test-actor",
      depositLocation: "cash",
    })
    const result = await Effect.runPromiseExit(reviewRequest({ requestId: request.id, action: "approved" }, "admin-1"))
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const failure = Cause.failureOption(result.cause)
      expect(failure._tag).toBe("Some")
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("ValidationError")
        expect(failure.value.message).toContain("payment")
      }
    }
    const [persisted] = await testDb.select().from(rateChangeRequests).where(eq(rateChangeRequests.id, request.id))
    expect(persisted.status).toBe("pending")
    const [persistedLoan] = await testDb.select().from(loans).where(eq(loans.id, loan.id))
    expect(persistedLoan.interestRateOverride).toBeNull()
  })
})
