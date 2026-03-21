import { Effect } from "effect"
import { db } from "@/lib/db"
import { creditors } from "@/lib/db/schema/creditors"
import { creditorInvestments } from "@/lib/db/schema/creditor-investments"
import { creditorRepayments } from "@/lib/db/schema/creditor-repayments"
import { eq, asc, sum } from "drizzle-orm"
import {
  DatabaseError,
  CreditorNotFound,
  InvestmentNotFound,
} from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { autoPostInterestExpense } from "@/services/transaction.service"
import {
  calculateInterest,
  allocatePayment,
  formatAmount,
} from "@/lib/interest/engine"
import BigNumber from "bignumber.js"
import type {
  Creditor,
  CreditorInvestment,
  CreditorRepayment,
  CreateCreditorInput,
  UpdateCreditorInput,
  AddInvestmentInput,
  RecordCreditorRepaymentInput,
  CreditorDashboard,
  CreditorInvestmentSummary,
} from "@/types"

/**
 * Computes integer calendar days between two dates.
 * Math.floor is acceptable for non-monetary integer day-count.
 */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Creates a new creditor record.
 * Writes audit log inside the same transaction.
 *
 * CRED-01: Creditor registration with name, contact, address.
 */
export const createCreditor = (
  input: CreateCreditorInput,
  actorId: string
): Effect.Effect<Creditor, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [creditor] = await tx
          .insert(creditors)
          .values({
            name: input.name,
            contact: input.contact,
            address: input.address,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "creditor.create",
          entityType: "creditor",
          entityId: creditor.id,
          beforeValue: null,
          afterValue: creditor,
        })

        return creditor
      })
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Updates an existing creditor's details.
 * Returns CreditorNotFound if creditor doesn't exist.
 * Writes audit log with before/after values.
 *
 * CRED-01: Creditor profile with edit capability.
 */
export const updateCreditor = (
  id: string,
  input: UpdateCreditorInput,
  actorId: string
): Effect.Effect<Creditor, CreditorNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [existing] = await db
        .select()
        .from(creditors)
        .where(eq(creditors.id, id))
      if (!existing) throw { _tag: "CreditorNotFound", id }

      const beforeValue = { ...existing }

      return await db.transaction(async (tx) => {
        const updates: Partial<typeof existing> & { updatedAt: Date } = {
          updatedAt: new Date(),
        }
        if (input.name !== undefined) updates.name = input.name
        if (input.contact !== undefined) updates.contact = input.contact
        if (input.address !== undefined) updates.address = input.address

        const [updated] = await tx
          .update(creditors)
          .set(updates)
          .where(eq(creditors.id, id))
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "creditor.update",
          entityType: "creditor",
          entityId: id,
          beforeValue,
          afterValue: updated,
        })

        return updated
      })
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound") return new CreditorNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * Fetches a single creditor by ID.
 * Returns CreditorNotFound if not found.
 */
export const getCreditor = (
  id: string
): Effect.Effect<Creditor, CreditorNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [creditor] = await db
        .select()
        .from(creditors)
        .where(eq(creditors.id, id))
      if (!creditor) throw { _tag: "CreditorNotFound", id }
      return creditor
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound") return new CreditorNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * Lists all creditors ordered alphabetically by name.
 */
export const listCreditors = (): Effect.Effect<Creditor[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.select().from(creditors).orderBy(asc(creditors.name))
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

/**
 * Adds an investment for a creditor.
 * Sets principalBalance equal to amount on creation.
 * Writes audit log.
 *
 * CRED-02: Multiple investments per creditor, each with its own rate and date.
 */
export const addInvestment = (
  input: AddInvestmentInput,
  actorId: string
): Effect.Effect<CreditorInvestment, CreditorNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Verify creditor exists
      const [creditor] = await db
        .select()
        .from(creditors)
        .where(eq(creditors.id, input.creditorId))
      if (!creditor) throw { _tag: "CreditorNotFound", id: input.creditorId }

      return await db.transaction(async (tx) => {
        const [investment] = await tx
          .insert(creditorInvestments)
          .values({
            creditorId: input.creditorId,
            amount: input.amount,
            interestRateMonthly: input.interestRateMonthly,
            investmentDate: new Date(input.investmentDate),
            // principalBalance starts equal to amount (CRED-02)
            principalBalance: input.amount,
            recordedBy: actorId,
          })
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "creditor_investment.create",
          entityType: "creditor_investment",
          entityId: investment.id,
          beforeValue: null,
          afterValue: investment,
        })

        return investment
      })
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound")
        return new CreditorNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * Records a repayment against a creditor investment.
 * Allocation is interest-first using allocatePayment() with minInterestDays=0.
 * Updates principalBalance on the investment.
 * Writes audit log inside the same transaction.
 *
 * CRED-03: Interest-first allocation using reducing balance.
 * CRED-04: Repayment allocates interest-first then principal.
 */
export const recordCreditorRepayment = (
  input: RecordCreditorRepaymentInput,
  actorId: string
): Effect.Effect<CreditorRepayment, InvestmentNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Fetch investment
      const [investment] = await db
        .select()
        .from(creditorInvestments)
        .where(eq(creditorInvestments.id, input.investmentId))
      if (!investment) throw { _tag: "InvestmentNotFound", id: input.investmentId }

      return await db.transaction(async (tx) => {
        // Determine days elapsed since last repayment or investment date
        const existingRepayments = await tx
          .select()
          .from(creditorRepayments)
          .where(eq(creditorRepayments.investmentId, input.investmentId))
          .orderBy(asc(creditorRepayments.repaymentDate), asc(creditorRepayments.createdAt))

        const prevDate =
          existingRepayments.length === 0
            ? new Date(investment.investmentDate)
            : new Date(existingRepayments[existingRepayments.length - 1].repaymentDate)

        const daysElapsed = daysBetween(prevDate, new Date(input.repaymentDate))

        // Allocate payment interest-first with minInterestDays=0 (creditors have no minimum)
        const allocation = allocatePayment({
          paymentAmount: input.amount,
          principalBalanceBefore: investment.principalBalance,
          monthlyRateDecimal: investment.interestRateMonthly,
          daysElapsed,
          minInterestDays: 0,
        })

        // Insert creditor repayment row
        const [repayment] = await tx
          .insert(creditorRepayments)
          .values({
            investmentId: input.investmentId,
            repaymentDate: new Date(input.repaymentDate),
            amount: input.amount,
            interestPortion: allocation.interestPortion,
            principalPortion: allocation.principalPortion,
            principalBalanceBefore: allocation.principalBalanceBefore,
            principalBalanceAfter: allocation.principalBalanceAfter,
            recordedBy: actorId,
          })
          .returning()

        // Update investment's principalBalance
        await tx
          .update(creditorInvestments)
          .set({
            principalBalance: allocation.principalBalanceAfter,
            updatedAt: new Date(),
          })
          .where(eq(creditorInvestments.id, input.investmentId))

        await writeAuditLog(tx, {
          actorId,
          action: "creditor_repayment.create",
          entityType: "creditor_repayment",
          entityId: repayment.id,
          beforeValue: {
            principalBalance: investment.principalBalance,
          },
          afterValue: repayment,
        })

        // Auto-post interest expense to transaction log (FINC-01)
        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await autoPostInterestExpense(tx, {
            amount: allocation.interestPortion,
            investmentId: input.investmentId,
            repaymentDate: input.repaymentDate,
            actorId,
          })
        }

        return repayment
      })
    },
    catch: (e: any) => {
      if (e?._tag === "InvestmentNotFound")
        return new InvestmentNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * Computes the creditor dashboard KPIs.
 * For each investment, calculates interest accrued using engine.ts with minInterestDays=0.
 * Aggregates across all investments for the creditor.
 *
 * CRED-05: Dashboard with totalInvested, interestAccrued, repaymentsMade, outstandingBalance.
 */
export const getCreditorDashboard = (
  creditorId: string
): Effect.Effect<CreditorDashboard, CreditorNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      // Verify creditor exists
      const [creditor] = await db
        .select()
        .from(creditors)
        .where(eq(creditors.id, creditorId))
      if (!creditor) throw { _tag: "CreditorNotFound", id: creditorId }

      // Fetch all investments for this creditor
      const investments = await db
        .select()
        .from(creditorInvestments)
        .where(eq(creditorInvestments.creditorId, creditorId))
        .orderBy(asc(creditorInvestments.investmentDate))

      const now = new Date()
      let totalInvested = new BigNumber(0)
      let totalInterestAccrued = new BigNumber(0)
      let totalRepaymentsMade = new BigNumber(0)

      const investmentSummaries: CreditorInvestmentSummary[] = []

      for (const investment of investments) {
        totalInvested = totalInvested.plus(investment.amount)

        // Fetch repayments for this investment
        const repayments = await db
          .select()
          .from(creditorRepayments)
          .where(eq(creditorRepayments.investmentId, investment.id))
          .orderBy(asc(creditorRepayments.repaymentDate), asc(creditorRepayments.createdAt))

        // Calculate total repaid for this investment
        const totalRepaid = repayments.reduce(
          (acc, r) => acc.plus(r.amount),
          new BigNumber(0)
        )
        totalRepaymentsMade = totalRepaymentsMade.plus(totalRepaid)

        // Calculate days elapsed since last repayment (or investment date)
        const prevDate =
          repayments.length === 0
            ? new Date(investment.investmentDate)
            : new Date(repayments[repayments.length - 1].repaymentDate)

        const daysElapsed = daysBetween(prevDate, now)

        // Interest accrues on current principalBalance with minInterestDays=0
        const interestAccrued = calculateInterest(
          investment.principalBalance,
          investment.interestRateMonthly,
          daysElapsed,
          0 // creditors have no minimum interest period
        )
        totalInterestAccrued = totalInterestAccrued.plus(interestAccrued)

        investmentSummaries.push({
          id: investment.id,
          amount: investment.amount,
          interestRateMonthly: investment.interestRateMonthly,
          investmentDate: new Date(investment.investmentDate),
          principalBalance: investment.principalBalance,
          interestAccrued: formatAmount(interestAccrued),
          totalRepaid: formatAmount(totalRepaid),
        })
      }

      // outstandingBalance = principal + interest accrued - repayments
      // Since repayments reduce principalBalance, we use:
      // outstandingBalance = sum(principalBalance) + totalInterestAccrued
      const totalPrincipalBalance = investments.reduce(
        (acc, inv) => acc.plus(inv.principalBalance),
        new BigNumber(0)
      )
      const outstandingBalance = totalPrincipalBalance.plus(totalInterestAccrued)

      return {
        totalInvested: formatAmount(totalInvested),
        interestAccrued: formatAmount(totalInterestAccrued),
        repaymentsMade: formatAmount(totalRepaymentsMade),
        outstandingBalance: formatAmount(outstandingBalance),
        investments: investmentSummaries,
      }
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound")
        return new CreditorNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * Aggregates capital data across ALL creditors.
 * Used to update the dashboard capitalInSystem KPI.
 *
 * CRED-06: System-wide capital view.
 */
export const getSystemCapital = (): Effect.Effect<
  {
    totalInvested: string
    totalInterestAccrued: string
    totalRepaymentsMade: string
    totalOutstanding: string
  },
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const allCreditors = await db.select().from(creditors)
      const now = new Date()

      let totalInvested = new BigNumber(0)
      let totalInterestAccrued = new BigNumber(0)
      let totalRepaymentsMade = new BigNumber(0)

      for (const creditor of allCreditors) {
        const investments = await db
          .select()
          .from(creditorInvestments)
          .where(eq(creditorInvestments.creditorId, creditor.id))

        for (const investment of investments) {
          totalInvested = totalInvested.plus(investment.amount)

          const repayments = await db
            .select()
            .from(creditorRepayments)
            .where(eq(creditorRepayments.investmentId, investment.id))
            .orderBy(asc(creditorRepayments.repaymentDate), asc(creditorRepayments.createdAt))

          const totalRepaid = repayments.reduce(
            (acc, r) => acc.plus(r.amount),
            new BigNumber(0)
          )
          totalRepaymentsMade = totalRepaymentsMade.plus(totalRepaid)

          const prevDate =
            repayments.length === 0
              ? new Date(investment.investmentDate)
              : new Date(repayments[repayments.length - 1].repaymentDate)

          const daysElapsed = daysBetween(prevDate, now)

          const interestAccrued = calculateInterest(
            investment.principalBalance,
            investment.interestRateMonthly,
            daysElapsed,
            0
          )
          totalInterestAccrued = totalInterestAccrued.plus(interestAccrued)
        }
      }

      const totalPrincipalBalance = await db
        .select({ total: sum(creditorInvestments.principalBalance) })
        .from(creditorInvestments)

      const totalPrincipal = new BigNumber(
        totalPrincipalBalance[0]?.total ?? "0"
      )
      const totalOutstanding = totalPrincipal.plus(totalInterestAccrued)

      return {
        totalInvested: formatAmount(totalInvested),
        totalInterestAccrued: formatAmount(totalInterestAccrued),
        totalRepaymentsMade: formatAmount(totalRepaymentsMade),
        totalOutstanding: formatAmount(totalOutstanding),
      }
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })
