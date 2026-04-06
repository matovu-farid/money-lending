import { Effect } from "effect"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { payments } from "@/lib/db/schema/payments"
import { customers } from "@/lib/db/schema/customers"
import { transactions } from "@/lib/db/schema/transactions"
import { eq, desc, asc, and, isNull } from "drizzle-orm"
import BigNumber from "bignumber.js"
import {
  DatabaseError,
  CustomerNotFound,
  LoanNotFound,
  IncompleteLoanRequirements,
  ValidationError,
} from "@/lib/errors"
import { writeAuditLog } from "./audit.service"
import { autoPostPrincipalDisbursement, postJournalEntry } from "./transaction.service"
import { recalculateFromPayment, reconcileDownstreamJournals } from "./payment.service"
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

      // Single active loan constraint
      const [existingActiveLoan] = await db
        .select()
        .from(loans)
        .where(
          and(
            eq(loans.customerId, input.customerId),
            eq(loans.status, "active"),
            isNull(loans.deletedAt)
          )
        )

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

      const startDate = new Date(input.startDate)

      return await db.transaction(async (tx) => {
        const [loan] = await tx
          .insert(loans)
          .values({
            customerId: input.customerId,
            principalAmount: input.rollover
              ? new BigNumber(input.principalAmount)
                  .plus(new BigNumber(input.rollover.carriedPrincipal))
                  .plus(new BigNumber(input.rollover.carriedInterest))
                  .toFixed(2)
              : input.principalAmount,
            issuanceFee: input.issuanceFee,
            description: input.description,
            interestRate: input.interestRate,
            minInterestDays: input.minInterestDays,
            startDate,
            status: "active",
            interestRateOverride: input.interestRateOverride ?? null,
            minPeriodOverride: input.minPeriodOverride ?? null,
            issuedBy: actorId,
            disbursementSource: input.disbursementSource,
            loanType: input.loanType ?? "perpetual",
            termMonths: (input.loanType && input.loanType !== "perpetual") ? input.termMonths! : null,
            rolledOverFrom: input.rollover?.fromLoanId ?? null,
            rolloverAmount: input.rollover
              ? new BigNumber(input.rollover.carriedPrincipal)
                  .plus(new BigNumber(input.rollover.carriedInterest))
                  .toFixed(2)
              : null,
          })
          .returning()

        const [coll] = await tx
          .insert(collateral)
          .values({
            loanId: loan.id,
            nature: input.collateral.nature,
            description: input.collateral.description ?? null,
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
              description: `Interest earned - loan ${existingActiveLoan.id.slice(0, 8).toUpperCase()} rolled over into ${loan.id.slice(0, 8).toUpperCase()}`,
              transactionDate: startDate,
              recordedBy: actorId,
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
                .toFixed(2),
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
            description: `Issuance fee for loan ${loan.id.slice(0, 8).toUpperCase()}`,
            transactionDate: startDate,
            recordedBy: actorId,
            debitDepositLocation: input.disbursementSource,
          })
        }

        // Auto-post principal disbursement as balance_sheet debit
        await autoPostPrincipalDisbursement(tx, {
          amount: loan.principalAmount,
          loanId: loan.id,
          transactionDate: startDate.toISOString(),
          actorId,
          depositLocation: input.disbursementSource,
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
  })

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
          description: loans.description,
          interestRate: loans.interestRate,
          minInterestDays: loans.minInterestDays,
          startDate: loans.startDate,
          status: loans.status,
          interestRateOverride: loans.interestRateOverride,
          minPeriodOverride: loans.minPeriodOverride,
          issuedBy: loans.issuedBy,
          disbursementSource: loans.disbursementSource,
          loanType: loans.loanType,
          termMonths: loans.termMonths,
          rolledOverFrom: loans.rolledOverFrom,
          rolloverAmount: loans.rolloverAmount,
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
      if (input.description !== undefined) {
        setObj.description = input.description
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

        // Update issuance fee transaction (credit only — do not touch disbursement debit)
        if (input.issuanceFee !== undefined) {
          await tx
            .update(transactions)
            .set({
              amount: input.issuanceFee,
              description: `Issuance fee for loan ${input.loanId.slice(0, 8).toUpperCase()}`,
            })
            .where(
              and(
                eq(transactions.referenceType, "loan"),
                eq(transactions.referenceId, input.loanId),
                eq(transactions.type, "credit")
              )
            )
        }

        // If principal changed, reverse old disbursement and post new one
        if (input.principalAmount !== undefined && input.principalAmount !== existingLoan.principalAmount) {
          const [oldDisbursement] = await tx
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.referenceType, "loan"),
                eq(transactions.referenceId, input.loanId),
                eq(transactions.type, "debit")
              )
            )

          if (oldDisbursement) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Cash", type: "asset" },
              creditCategory: { name: "Loans Receivable", type: "asset" },
              amount: oldDisbursement.amount,
              referenceType: "loan_reversal",
              referenceId: input.loanId,
              description: `Reversal - principal updated for loan ${input.loanId.slice(0, 8).toUpperCase()}`,
              transactionDate: oldDisbursement.transactionDate,
              recordedBy: actorId,
              debitDepositLocation: oldDisbursement.depositLocation ?? existingLoan.disbursementSource,
              creditDepositLocation: oldDisbursement.depositLocation ?? existingLoan.disbursementSource,
            })

            await postJournalEntry(tx, {
              debitCategory: { name: "Loans Receivable", type: "asset" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: input.principalAmount,
              referenceType: "loan",
              referenceId: input.loanId,
              description: `Principal disbursed - loan ${input.loanId.slice(0, 8).toUpperCase()} (updated)`,
              transactionDate: oldDisbursement.transactionDate,
              recordedBy: actorId,
              debitDepositLocation: oldDisbursement.depositLocation ?? existingLoan.disbursementSource,
              creditDepositLocation: oldDisbursement.depositLocation ?? existingLoan.disbursementSource,
            })
          }

          // Recalculate all existing payments from the start since principalBalanceBefore changed
          const activePayments = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.loanId, input.loanId), isNull(payments.deletedAt)))
            .orderBy(asc(payments.paymentDate), asc(payments.createdAt))

          if (activePayments.length > 0) {
            const oldInterestMap = new Map<string, string>()
            const oldPrincipalMap = new Map<string, string>()
            for (const p of activePayments) {
              oldInterestMap.set(p.id, p.interestPortion)
              oldPrincipalMap.set(p.id, p.principalPortion)
            }

            await recalculateFromPayment(tx, input.loanId, 0, activePayments)
            await reconcileDownstreamJournals(
              tx,
              activePayments,
              oldInterestMap,
              oldPrincipalMap,
              input.loanId,
              actorId
            )
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
            description: `Reversal - loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: feeTx.transactionDate,
            recordedBy: actorId,
            creditDepositLocation: feeTx.depositLocation ?? undefined,
          })
        }

        // Reverse principal disbursement
        const [disbursementTx] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.referenceType, "loan"),
              eq(transactions.referenceId, input.loanId),
              eq(transactions.type, "debit")
            )
          )

        if (disbursementTx) {
          await postJournalEntry(tx, {
            debitCategory: { name: "Cash", type: "asset" },
            creditCategory: { name: "Loans Receivable", type: "asset" },
            amount: disbursementTx.amount,
            referenceType: "loan_reversal",
            referenceId: input.loanId,
            description: `Reversal - principal disbursement for loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
            transactionDate: disbursementTx.transactionDate,
            recordedBy: actorId,
            debitDepositLocation: disbursementTx.depositLocation ?? undefined,
            creditDepositLocation: disbursementTx.depositLocation ?? undefined,
          })
        }

        // Reverse interest/principal transactions for payments that were active at deletion time
        // (already-deleted payments had their journals reversed when they were individually deleted)
        const loanPayments = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.loanId, input.loanId), eq(payments.deletedAt, now)))

        for (const p of loanPayments) {
          if (new BigNumber(p.interestPortion).isGreaterThan(0)) {
            await postJournalEntry(tx, {
              debitCategory: { name: "Interest Earned", type: "revenue" },
              creditCategory: { name: "Cash", type: "asset" },
              amount: p.interestPortion,
              referenceType: "payment_reversal",
              referenceId: p.id,
              description: `Reversal - loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
              transactionDate: new Date(p.paymentDate),
              recordedBy: actorId,
              creditDepositLocation: p.depositLocation ?? undefined,
            })
          }

            if (new BigNumber(p.principalPortion).isGreaterThan(0)) {
              await postJournalEntry(tx, {
                debitCategory: { name: "Loans Receivable", type: "asset" },
                creditCategory: { name: "Cash", type: "asset" },
                amount: p.principalPortion,
                referenceType: "payment_reversal",
                referenceId: p.id,
                description: `Reversal - principal repayment for loan ${input.loanId.slice(0, 8).toUpperCase()} deleted: ${input.reason}`,
                transactionDate: new Date(p.paymentDate),
                recordedBy: actorId,
                debitDepositLocation: p.depositLocation ?? undefined,
                creditDepositLocation: p.depositLocation ?? undefined,
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
