import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { payments } from "@/lib/db/schema/payments"
import { getBaseRate } from "@/lib/interest/effective-rate"
import { customers } from "@/lib/db/schema/customers"
import { transactions } from "@/lib/db/schema/transactions"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { loanBalances } from "@/lib/db/schema/loan-balances"
import { eq, desc, asc, and, isNull, sql } from "drizzle-orm"
import { shortId } from "@/lib/utils"
import BigNumber from "bignumber.js"
import {
  DatabaseError,
  CustomerNotFound,
  LoanNotFound,
  IncompleteLoanRequirements,
  ValidationError,
} from "@/lib/errors"
import { isUniqueConstraintError } from "@/lib/db-errors"
import { writeAuditLog } from "./audit.service"
import { postJournalEntry } from "./transaction.service"
import { autoPostPrincipalDisbursement, autoPostRolloverPrincipalTransfer, autoPostInterestEarned, autoPostPrincipalRepayment } from "./auto-post.service"
import { getPaymentPortionsFromLedger } from "./ledger-queries.service"
import { allocatePayment } from "@/lib/interest/engine"
import { daysBetween } from "@/lib/db/utils"
import type { CreateLoanInput, UpdateLoanInput, DeleteLoanInput, Loan, LoanWithCustomer } from "@/types"

const checkCustomerCompleteness = (customer: {
  fullName: string | null
  contact: string | null
  address: string | null
}): string[] => {
  const missing: string[] = []
  if (!customer.fullName?.trim()) missing.push("fullName")
  if (!customer.contact?.trim()) missing.push("contact")
  if (!customer.address?.trim()) missing.push("address")
  return missing
}

export const createLoan = (
  input: CreateLoanInput,
  actorId: string
): Effect.Effect<
  Loan & { collateral: { id: string; nature: string; description: string | null } },
  CustomerNotFound | IncompleteLoanRequirements | ValidationError | DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, input.customerId))

      if (!customer) throw { _tag: "CustomerNotFound", id: input.customerId }

      if (customer.status === "blacklisted") {
        throw new ValidationError({ message: "This customer is blacklisted and cannot receive new loans.", field: "customerId" })
      }

      const missingFields = checkCustomerCompleteness(customer)
      if (missingFields.length > 0) {
        throw { _tag: "IncompleteLoanRequirements", missing: missingFields }
      }

      const startDate = new Date(input.startDate)

      return await db.transaction(async (tx) => {
        // Single active loan constraint — checked inside the transaction with
        // FOR UPDATE to serialize concurrent loan creation for the same customer
        const [existingActiveLoan] = await tx
          .select()
          .from(loans)
          .where(
            and(
              eq(loans.customerId, input.customerId),
              eq(loans.status, "active"),
              isNull(loans.deletedAt)
            )
          )
          .for('update')

        if (existingActiveLoan && !input.rollover) {
          throw new ValidationError({
            message: "Customer already has an active loan. Use rollover to create a new loan.",
            field: "customerId",
          })
        }

        if (input.rollover && !existingActiveLoan) {
          throw new ValidationError({
            message: "Rollover specified but customer has no active loan.",
            field: "customerId",
          })
        }

        if (input.rollover && existingActiveLoan && input.rollover.fromLoanId !== existingActiveLoan.id) {
          throw new ValidationError({
            message: "Rollover loan ID does not match customer's active loan.",
            field: "customerId",
          })
        }

        const loanValues = {
            ...(input.id ? { id: input.id } : {}),
            customerId: input.customerId,
            principalAmount: input.rollover
              ? new BigNumber(input.principalAmount)
                  .plus(new BigNumber(input.rollover.carriedPrincipal))
                  .plus(new BigNumber(input.rollover.carriedInterest))
                  .toFixed(0)
              : input.principalAmount,
            issuanceFee: input.issuanceFee,
            interestRate: input.interestRate,
            minInterestDays: input.minInterestDays,
            startDate,
            status: "active" as const,
            interestRateOverride: input.interestRateOverride ?? null,
            minPeriodOverride: input.minPeriodOverride ?? null,
            issuedBy: actorId,
            disbursementSource: input.disbursementSource,
            subLocationId: input.subLocationId ?? null,
            loanType: input.loanType ?? "perpetual",
            termMonths: input.termMonths ?? null,
            rolledOverFrom: input.rollover?.fromLoanId ?? null,
            rolloverAmount: input.rollover
              ? new BigNumber(input.rollover.carriedPrincipal)
                  .plus(new BigNumber(input.rollover.carriedInterest))
                  .toFixed(0)
              : null,
            ...(input.backdateNote ? {
              backdatedFrom: new Date(),
              backdatedBy: actorId,
              backdatedAt: new Date(),
              backdateNote: input.backdateNote,
            } : {}),
          }

        const [loan] = await tx
          .insert(loans)
          .values(loanValues)
          .returning()

        const [coll] = await tx
          .insert(collateral)
          .values({
            loanId: loan.id,
            nature: input.collateral.nature,
            description: input.collateral.description,
          })
          .returning()

        // Handle rollover: close old loan
        if (input.rollover && existingActiveLoan) {
          // Post old loan's accrued interest as earned
          if (new BigNumber(input.rollover.carriedInterest).isGreaterThan(0)) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Interest Earned", type: "revenue" },
              amount: input.rollover.carriedInterest,
              referenceType: "rollover",
              referenceId: existingActiveLoan.id,
              description: `Interest earned - loan ${shortId(existingActiveLoan.id).toUpperCase()} rolled over into ${shortId(loan.id).toUpperCase()}`,
              transactionDate: startDate,
              recordedBy: actorId,
              loanId: loan.id,
            })
          }

          // Transfer carried principal from old loan to new loan on the ledger
          if (new BigNumber(input.rollover.carriedPrincipal).isGreaterThan(0)) {
            await autoPostRolloverPrincipalTransfer(tx, {
              amount: input.rollover.carriedPrincipal,
              newLoanId: loan.id,
              oldLoanId: existingActiveLoan.id,
              transactionDate: startDate,
              actorId,
            })
          }

          // Close old loan
          await tx
            .update(loans)
            .set({ status: "rolled_over", updatedAt: new Date() })
            .where(eq(loans.id, existingActiveLoan.id))

          // Audit log for old loan
          await writeAuditLog(tx, {
            actorId,
            action: "loan.rollover",
            entityType: "loan",
            entityId: existingActiveLoan.id,
            beforeValue: existingActiveLoan,
            afterValue: {
              status: "rolled_over",
              rolledIntoLoanId: loan.id,
              carriedPrincipal: input.rollover.carriedPrincipal,
              carriedInterest: input.rollover.carriedInterest,
            },
          })
        }

        await writeAuditLog(tx, {
          actorId,
          action: "loan.create",
          entityType: "loan",
          entityId: loan.id,
          beforeValue: null,
          afterValue: {
            ...loan,
            collateral: coll,
            ...(input.rollover && {
              rolloverFrom: input.rollover.fromLoanId,
              freshAmount: input.principalAmount,
              rolloverAmount: new BigNumber(input.rollover.carriedPrincipal)
                .plus(new BigNumber(input.rollover.carriedInterest))
                .toFixed(0),
            }),
          },
        })

        // Auto-post issuance fee as income transaction (skip if zero)
        if (new BigNumber(input.issuanceFee).isGreaterThan(0)) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Cash", type: "asset" },
            creditCategory: { name: "Issuance Fees", type: "revenue" },
            amount: input.issuanceFee,
            referenceType: "loan",
            referenceId: loan.id,
            description: `Issuance fee for loan ${shortId(loan.id).toUpperCase()}`,
            transactionDate: startDate,
            recordedBy: actorId,
            debitDepositLocation: input.disbursementSource,
            debitSubLocationId: input.subLocationId,
            loanId: loan.id,
          })
        }

        // Auto-post principal disbursement as balance_sheet debit
        // Only disburse the fresh cash amount — carried amounts are book transfers, not cash movements
        const freshDisbursementAmount = input.rollover
          ? input.principalAmount  // fresh cash only (excludes carriedPrincipal + carriedInterest)
          : loan.principalAmount

        // Validate funds are available at the chosen source / sub-location before
        // posting the disbursement. For "bank" with a sub-location, scope the
        // check to that specific bank account; otherwise check the whole source.
        if (new BigNumber(freshDisbursementAmount).isGreaterThan(0)) {
          const balanceConds = [
            eq(transactionCategories.name, "Cash"),
            eq(transactions.depositLocation, input.disbursementSource),
          ]
          if (input.disbursementSource === "bank" && input.subLocationId) {
            balanceConds.push(eq(transactions.subLocationId, input.subLocationId))
          }
          const [balanceRow] = await tx
            .select({
              total: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'debit' THEN ${transactions.amount} ELSE -${transactions.amount} END), '0')`,
            })
            .from(transactions)
            .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
            .where(and(...balanceConds))

          // The just-posted issuance fee debit already increased this source's
          // balance, so subtract it back out to compare against pre-fee funds.
          const issuanceFeeAtSource = new BigNumber(input.issuanceFee)
          const available = new BigNumber(balanceRow?.total ?? "0").minus(issuanceFeeAtSource)

          if (available.isLessThan(freshDisbursementAmount)) {
            const where =
              input.disbursementSource === "bank" && input.subLocationId
                ? "this bank account"
                : `the ${input.disbursementSource.replace("_", " ")} source`
            throw new ValidationError({
              message: `Insufficient funds at ${where} to disburse this loan.`,
              field: input.disbursementSource === "bank" && input.subLocationId ? "subLocationId" : "disbursementSource",
            })
          }
        }

        await autoPostPrincipalDisbursement(tx, {
          amount: freshDisbursementAmount,
          loanId: loan.id,
          transactionDate: startDate.toISOString(),
          actorId,
          depositLocation: input.disbursementSource,
          subLocationId: input.subLocationId,
        })

        return { ...loan, collateral: coll }
      })
    },
    catch: (e: any) => {
      if (e instanceof ValidationError) return e
      if (e?._tag === "ValidationError") return new ValidationError({ message: e.message, field: e.field })
      if (e?._tag === "CustomerNotFound") return new CustomerNotFound({ id: e.id })
      if (e?._tag === "IncompleteLoanRequirements")
        return new IncompleteLoanRequirements({ missing: e.missing })
      return new DatabaseError({ cause: e })
    },
  }).pipe(
    Effect.catchIf(
      (e) => e._tag === "DatabaseError" && !!input.id && isUniqueConstraintError(e.cause),
      () => createLoan({ ...input, id: undefined }, actorId)
    )
  )

export const getLoan = (
  id: string
): Effect.Effect<Loan, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: () => db.select().from(loans).where(and(eq(loans.id, id), isNull(loans.deletedAt))),
    catch: (e) => new DatabaseError({ cause: e }),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0] as Loan) : Effect.fail(new LoanNotFound({ id }))
    )
  )

export const listLoans = (): Effect.Effect<LoanWithCustomer[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          id: loans.id,
          customerId: loans.customerId,
          principalAmount: loans.principalAmount,
          issuanceFee: loans.issuanceFee,
          interestRate: loans.interestRate,
          minInterestDays: loans.minInterestDays,
          startDate: loans.startDate,
          status: loans.status,
          interestRateOverride: loans.interestRateOverride,
          minPeriodOverride: loans.minPeriodOverride,
          issuedBy: loans.issuedBy,
          disbursementSource: loans.disbursementSource,
          subLocationId: loans.subLocationId,
          loanType: loans.loanType,
          termMonths: loans.termMonths,
          penaltyMultiplier: loans.penaltyMultiplier,
          penaltyWaived: loans.penaltyWaived,
          penaltyWaivedBy: loans.penaltyWaivedBy,
          penaltyWaivedAt: loans.penaltyWaivedAt,
          rolledOverFrom: loans.rolledOverFrom,
          rolloverAmount: loans.rolloverAmount,
          backdatedFrom: loans.backdatedFrom,
          backdatedBy: loans.backdatedBy,
          backdatedAt: loans.backdatedAt,
          backdateNote: loans.backdateNote,
          createdAt: loans.createdAt,
          updatedAt: loans.updatedAt,
          deletedAt: loans.deletedAt,
          customerName: customers.fullName,
          customerContact: customers.contact,
        })
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(isNull(loans.deletedAt))
        .orderBy(desc(loans.createdAt))
        .limit(500)
      return rows
    },
    catch: (e) => new DatabaseError({ cause: e }),
  })

export const updateLoan = (
  input: UpdateLoanInput,
  actorId: string
): Effect.Effect<Loan, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [existingLoan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)))

      if (!existingLoan) throw { _tag: "LoanNotFound", id: input.loanId }

      const setObj: Partial<typeof loans.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      }
      if (input.principalAmount !== undefined) {
        setObj.principalAmount = input.principalAmount
      }
      if (input.interestRate !== undefined) {
        setObj.interestRate = input.interestRate
      }
      if (input.startDate !== undefined) {
        setObj.startDate = new Date(input.startDate)
      }
      if (input.issuanceFee !== undefined) {
        setObj.issuanceFee = input.issuanceFee
      }
      return await db.transaction(async (tx) => {
        const [updatedLoan] = await tx
          .update(loans)
          .set(setObj)
          .where(eq(loans.id, input.loanId))
          .returning()

        await writeAuditLog(tx, {
          actorId,
          action: "loan.update",
          entityType: "loan",
          entityId: input.loanId,
          beforeValue: existingLoan,
          afterValue: { ...setObj, reason: input.reason },
        })

        if (input.issuanceFee !== undefined && input.issuanceFee !== existingLoan.issuanceFee) {
          // Find the old fee credit to get the journalGroupId and amount
          const [oldFeeTx] = await tx
            .select({
              id: transactions.id,
              amount: transactions.amount,
              transactionDate: transactions.transactionDate,
              depositLocation: transactions.depositLocation,
              subLocationId: transactions.subLocationId,
              journalGroupId: transactions.journalGroupId,
            })
            .from(transactions)
            .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
            .where(
              and(
                eq(transactions.referenceType, "loan"),
                eq(transactions.referenceId, input.loanId),
                eq(transactions.type, "credit"),
                eq(transactionCategories.name, "Issuance Fees")
              )
            )

          if (oldFeeTx) {
            // Reverse old fee pair
            await postJournalEntry(tx, {
              debitCategory: { name: "Issuance Fees", type: "revenue" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: oldFeeTx.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - issuance fee updated for loan ${shortId(input.loanId).toUpperCase()}`,
              transactionDate: oldFeeTx.transactionDate,
              recordedBy: actorId,
              creditDepositLocation: oldFeeTx.depositLocation ?? undefined,
              creditSubLocationId: oldFeeTx.subLocationId ?? undefined,
              loanId: input.loanId,
            })
          }

          // Post new fee pair (if non-zero)
          if (new BigNumber(input.issuanceFee).isGreaterThan(0)) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Cash", type: "asset" },
              creditCategory: { name: "Issuance Fees", type: "revenue" },
              amount: input.issuanceFee,
              referenceType: "loan",
              referenceId: input.loanId,
              description: `Issuance fee for loan ${shortId(input.loanId).toUpperCase()}`,
              transactionDate: oldFeeTx?.transactionDate ?? new Date(),
              recordedBy: actorId,
              debitDepositLocation: existingLoan.disbursementSource,
              debitSubLocationId: existingLoan.subLocationId ?? undefined,
              loanId: input.loanId,
            })
          }
        }

        // If principal changed, reverse old disbursement and post new one
        if (input.principalAmount !== undefined && input.principalAmount !== existingLoan.principalAmount) {
          const [oldDisbursement] = await tx
            .select()
            .from(transactions)
            .where(
              and(
                sql`${transactions.referenceType} IN ('loan', 'loan_repost')`,
                eq(transactions.referenceId, input.loanId),
                eq(transactions.type, "debit")
              )
            )
            .orderBy(desc(transactions.createdAt))
            .limit(1)

          if (oldDisbursement) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Cash", type: "asset" },
              creditCategory: { name: "Loans Receivable", type: "asset" },
              amount: oldDisbursement.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - principal updated for loan ${shortId(input.loanId).toUpperCase()}`,
              transactionDate: oldDisbursement.transactionDate,
              recordedBy: actorId,
              debitDepositLocation: oldDisbursement.depositLocation ?? existingLoan.disbursementSource,
              debitSubLocationId: oldDisbursement.subLocationId ?? existingLoan.subLocationId ?? undefined,
              loanId: input.loanId,
            })

            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: input.principalAmount,
              referenceType: "loan_repost",
              referenceId: input.loanId,
              description: `Principal disbursed - loan ${shortId(input.loanId).toUpperCase()} (updated)`,
              transactionDate: oldDisbursement.transactionDate,
              recordedBy: actorId,
              creditDepositLocation: oldDisbursement.depositLocation ?? existingLoan.disbursementSource,
              creditSubLocationId: oldDisbursement.subLocationId ?? existingLoan.subLocationId ?? undefined,
              loanId: input.loanId,
            })
          }

          // Recalculate all existing payments: reverse old journals, repost with new allocation
          const activePayments = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt), eq(payments.markedWrong, false)))
            .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

          if (activePayments.length > 0) {
            // Fetch all payment portions from ledger
            const paymentIds = activePayments.map((p) => p.id)
            const oldPortions = await getPaymentPortionsFromLedger(paymentIds, tx)

            // Reverse all payment journals
            for (const p of activePayments) {
              const portion = oldPortions.get(p.id)
              if (!portion) continue

              if (new BigNumber(portion.interestPortion).isGreaterThan(0)) {
                await postJournalEntry(tx, {
                  debitCategory: { name: "Interest Earned", type: "revenue" },
                  creditCategory: { name: "Cash", type: "asset" },
                  amount: portion.interestPortion,
                  referenceType: "payment_reversal",
                  referenceId: p.id,
                  description: `Reversal - principal updated for loan ${shortId(input.loanId).toUpperCase()}`,
                  transactionDate: new Date(p.paymentDate),
                  recordedBy: actorId,
                  creditDepositLocation: p.depositLocation ?? undefined,
                  creditSubLocationId: p.subLocationId ?? undefined,
                  loanId: input.loanId,
                })
              }

              if (new BigNumber(portion.principalPortion).isGreaterThan(0)) {
                await postJournalEntry(tx, {
                  debitCategory: { name: "Loans Receivable", type: "asset" },
                  creditCategory: { name: "Cash", type: "asset" },
                  amount: portion.principalPortion,
                  referenceType: "payment_reversal",
                  referenceId: p.id,
                  description: `Reversal - principal repayment updated for loan ${shortId(input.loanId).toUpperCase()}`,
                  transactionDate: new Date(p.paymentDate),
                  recordedBy: actorId,
                  creditDepositLocation: p.depositLocation ?? undefined,
                  creditSubLocationId: p.subLocationId ?? undefined,
                  loanId: input.loanId,
                })
              }
            }

            // Repost with new allocations based on updated principal
            const loanType = updatedLoan.loanType ?? "perpetual"
            const monthlyRateDecimal = getBaseRate(updatedLoan)
            const minInterestDays = updatedLoan.minPeriodOverride ?? updatedLoan.minInterestDays
            let runningBalance = new BigNumber(input.principalAmount)

            for (let i = 0; i < activePayments.length; i++) {
              const p = activePayments[i]
              const prevDate = i === 0
                ? new Date(updatedLoan.startDate)
                : new Date(activePayments[i - 1].paymentDate)
              const daysElapsed = daysBetween(prevDate, new Date(p.paymentDate))

              const allocation = allocatePayment({
                paymentAmount: p.amount,
                principalBalanceBefore: runningBalance.toFixed(0),
                monthlyRateDecimal,
                daysElapsed,
                minInterestDays,
                loanType,
                originalPrincipal: input.principalAmount,
                termMonths: updatedLoan.termMonths ?? undefined,
                paymentNumber: i + 1,
              })

              if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
                await autoPostInterestEarned(tx, {
                  amount: allocation.interestPortion,
                  loanId: input.loanId,
                  paymentId: p.id,
                  paymentDate: p.paymentDate.toISOString(),
                  actorId,
                  depositLocation: p.depositLocation ?? undefined,
                })
              }

              if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
                await autoPostPrincipalRepayment(tx, {
                  amount: allocation.principalPortion,
                  loanId: input.loanId,
                  paymentId: p.id,
                  paymentDate: p.paymentDate.toISOString(),
                  actorId,
                  depositLocation: p.depositLocation ?? undefined,
                })
              }

              runningBalance = runningBalance.minus(new BigNumber(allocation.principalPortion))
            }
          }
        }

        return updatedLoan as Loan
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

export const deleteLoan = (
  input: DeleteLoanInput,
  actorId: string
): Effect.Effect<Loan, LoanNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [existingLoan] = await db
        .select()
        .from(loans)
        .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)))

      if (!existingLoan) throw { _tag: "LoanNotFound", id: input.loanId }

      const now = new Date()

      return await db.transaction(async (tx) => {
        await writeAuditLog(tx, {
          actorId,
          action: "loan.delete",
          entityType: "loan",
          entityId: input.loanId,
          beforeValue: existingLoan,
          afterValue: { reason: input.reason },
        })

        // Collect active payments BEFORE soft-deleting them
        const activePaymentIds = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))

        await tx
          .update(payments)
          .set({ deletedAt: now, deletedBy: actorId, deleteReason: input.reason, updatedAt: now })
          .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))

        // Reverse issuance fee transaction (credit type distinguishes it from disbursement debit)
        const [feeTx] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.referenceType, "loan"),
              eq(transactions.referenceId, input.loanId),
              eq(transactions.type, "credit")
            )
          )

        if (feeTx) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Issuance Fees", type: "revenue" },
            creditCategory: { name: "Cash", type: "asset" },
            amount: feeTx.amount,
            referenceType: "loan_reversal",
            referenceId: input.loanId,
            description: `Reversal - loan ${shortId(input.loanId).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: feeTx.transactionDate,
            recordedBy: actorId,
            creditDepositLocation: feeTx.depositLocation ?? undefined,
            creditSubLocationId: feeTx.subLocationId ?? undefined,
            loanId: input.loanId,
          })
        }

        // Reverse principal disbursement.
        // Filter by category — issuance fee and disbursement share reference_type='loan'
        // and the same createdAt, so without the category filter the query can return
        // the fee row and reverse the wrong amount.
        const [disbursementTx] = await tx
          .select({
            amount: transactions.amount,
            transactionDate: transactions.transactionDate,
            depositLocation: transactions.depositLocation,
            subLocationId: transactions.subLocationId,
          })
          .from(transactions)
          .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
          .where(
            and(
              sql`${transactions.referenceType} IN ('loan', 'loan_repost')`,
              eq(transactions.referenceId, input.loanId),
              eq(transactions.type, "debit"),
              eq(transactionCategories.name, "Loans Receivable")
            )
          )
          .orderBy(desc(transactions.createdAt))
          .limit(1)

        if (disbursementTx) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Cash", type: "asset" },
            creditCategory: { name: "Loans Receivable", type: "asset" },
            amount: disbursementTx.amount,
            referenceType: "loan_reversal",
            referenceId: input.loanId,
            description: `Reversal - principal disbursement for loan ${shortId(input.loanId).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: disbursementTx.transactionDate,
            recordedBy: actorId,
            debitDepositLocation: disbursementTx.depositLocation ?? undefined,
            debitSubLocationId: disbursementTx.subLocationId ?? undefined,
            loanId: input.loanId,
          })
        }

        // Reverse interest/principal transactions for payments that were active at deletion time
        // (already-deleted payments had their journals reversed when they were individually deleted)
        const loanPayments = activePaymentIds
        const paymentPortions = loanPayments.length > 0
          ? await getPaymentPortionsFromLedger(loanPayments.map((p) => p.id), tx)
          : new Map()

        for (const p of loanPayments) {
          const portion = paymentPortions.get(p.id)
          if (!portion) continue

          if (new BigNumber(portion.interestPortion).isGreaterThan(0)) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Interest Earned", type: "revenue" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: portion.interestPortion,
              referenceType: "payment_reversal",
              referenceId: p.id,
              description: `Reversal - loan ${shortId(input.loanId).toUpperCase()} deleted: ${input.reason}`,
              transactionDate: new Date(p.paymentDate),
              recordedBy: actorId,
              creditDepositLocation: p.depositLocation ?? undefined,
              creditSubLocationId: p.subLocationId ?? undefined,
              loanId: input.loanId,
            })
          }

            if (new BigNumber(portion.principalPortion).isGreaterThan(0)) {
              await postJournalEntry(tx, {
                debitCategory: { name: "Loans Receivable", type: "asset" },
                creditCategory: { name: "Cash", type: "asset" },
                amount: portion.principalPortion,
                referenceType: "payment_reversal",
                referenceId: p.id,
                description: `Reversal - principal repayment for loan ${shortId(input.loanId).toUpperCase()} deleted: ${input.reason}`,
                transactionDate: new Date(p.paymentDate),
                recordedBy: actorId,
                creditDepositLocation: p.depositLocation ?? undefined,
                creditSubLocationId: p.subLocationId ?? undefined,
                loanId: input.loanId,
              })
            }
        }

        // Reverse rollover ledger entries (carried principal + carried interest debits on Loans Receivable)
        if (existingLoan.rolledOverFrom) {
          const rolloverDebits = await tx
            .select({ amount: transactions.amount, transactionDate: transactions.transactionDate })
            .from(transactions)
            .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
            .where(
              and(
                eq(transactions.referenceType, "rollover"),
                eq(transactions.loanId, input.loanId),
                eq(transactions.type, "debit"),
                eq(transactionCategories.name, "Loans Receivable")
              )
            )

          for (const entry of rolloverDebits) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Cash", type: "asset" },
              creditCategory: { name: "Loans Receivable", type: "asset" },
              amount: entry.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - rollover entry for deleted loan ${shortId(input.loanId).toUpperCase()}: ${input.reason}`,
              transactionDate: entry.transactionDate,
              recordedBy: actorId,
              loanId: input.loanId,
            })
          }

          // Also reverse the Interest Earned credit posted for carried interest
          const rolloverInterestCredits = await tx
            .select({ amount: transactions.amount, transactionDate: transactions.transactionDate })
            .from(transactions)
            .innerJoin(transactionCategories, eq(transactions.categoryId, transactionCategories.id))
            .where(
              and(
                eq(transactions.referenceType, "rollover"),
                eq(transactions.loanId, input.loanId),
                eq(transactions.type, "credit"),
                eq(transactionCategories.name, "Interest Earned")
              )
            )

          for (const entry of rolloverInterestCredits) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Interest Earned", type: "revenue" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: entry.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - rollover interest for deleted loan ${shortId(input.loanId).toUpperCase()}: ${input.reason}`,
              transactionDate: entry.transactionDate,
              recordedBy: actorId,
              loanId: input.loanId,
            })
          }
        }

        await tx
          .update(loans)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(loans.id, input.loanId))

        return existingLoan as Loan
      })
    },
    catch: (e: any) => {
      if (e?._tag === "LoanNotFound") return new LoanNotFound({ id: e.id })
      return new DatabaseError({ cause: e })
    },
  })

/**
 * List all loan_balances projection rows. Used by the query-backed
 * loanBalanceCollection after migrating from Electric.
 */
export const listLoanBalances = (): Effect.Effect<
  (typeof loanBalances.$inferSelect)[],
  DatabaseError
> =>
  Effect.tryPromise({
    try: () => db.select().from(loanBalances),
    catch: (e) => new DatabaseError({ cause: e }),
  })
