import { Effect } from "effect";
import { db } from "@/lib/db";
import { creditors } from "@/lib/db/schema/creditors";
import { creditorInvestments } from "@/lib/db/schema/creditor-investments";
import { creditorRepayments } from "@/lib/db/schema/creditor-repayments";
import { eq, asc, inArray } from "drizzle-orm";
import {
  DatabaseError,
  CreditorNotFound,
  InvestmentNotFound,
} from "@/lib/errors";
import { writeAuditLog } from "./audit.service";
import { autoPostInterestExpense, autoPostCreditorInvestment, autoPostCreditorPrincipalRepaid, getCreditorBalancesFromLedger } from "@/services/transaction.service";
import {
  calculateInterest,
  allocatePayment,
  formatAmount,
} from "@/lib/interest/engine";
import BigNumber from "bignumber.js";
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
} from "@/types";

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export const createCreditor = (
  input: CreateCreditorInput,
  actorId: string,
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
          .returning();

        await writeAuditLog(tx, {
          actorId,
          action: "creditor.create",
          entityType: "creditor",
          entityId: creditor.id,
          beforeValue: null,
          afterValue: creditor,
        });

        return creditor;
      });
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

export const updateCreditor = (
  id: string,
  input: UpdateCreditorInput,
  actorId: string,
): Effect.Effect<Creditor, CreditorNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [existing] = await db
        .select()
        .from(creditors)
        .where(eq(creditors.id, id));
      if (!existing) throw { _tag: "CreditorNotFound", id };

      const beforeValue = { ...existing };

      return await db.transaction(async (tx) => {
        const updates: Partial<typeof existing> & { updatedAt: Date } = {
          updatedAt: new Date(),
        };
        if (input.name !== undefined) updates.name = input.name;
        if (input.contact !== undefined) updates.contact = input.contact;
        if (input.address !== undefined) updates.address = input.address;

        const [updated] = await tx
          .update(creditors)
          .set(updates)
          .where(eq(creditors.id, id))
          .returning();

        await writeAuditLog(tx, {
          actorId,
          action: "creditor.update",
          entityType: "creditor",
          entityId: id,
          beforeValue,
          afterValue: updated,
        });

        return updated;
      });
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound")
        return new CreditorNotFound({ id: e.id });
      return new DatabaseError({ cause: e });
    },
  });

export const getCreditor = (
  id: string,
): Effect.Effect<Creditor, CreditorNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [creditor] = await db
        .select()
        .from(creditors)
        .where(eq(creditors.id, id));
      if (!creditor) throw { _tag: "CreditorNotFound", id };
      return creditor;
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound")
        return new CreditorNotFound({ id: e.id });
      return new DatabaseError({ cause: e });
    },
  });

export const listCreditors = (): Effect.Effect<Creditor[], DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.select().from(creditors).orderBy(asc(creditors.name));
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

export const addInvestment = (
  input: AddInvestmentInput,
  actorId: string,
): Effect.Effect<CreditorInvestment, CreditorNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [creditor] = await db
        .select()
        .from(creditors)
        .where(eq(creditors.id, input.creditorId));
      if (!creditor) throw { _tag: "CreditorNotFound", id: input.creditorId };

      return await db.transaction(async (tx) => {
        const [investment] = await tx
          .insert(creditorInvestments)
          .values({
            creditorId: input.creditorId,
            amount: input.amount,
            interestRateMonthly: input.interestRateMonthly,
            investmentDate: new Date(input.investmentDate),
            principalBalance: input.amount,
            recordedBy: actorId,
          })
          .returning();

        await writeAuditLog(tx, {
          actorId,
          action: "creditor_investment.create",
          entityType: "creditor_investment",
          entityId: investment.id,
          beforeValue: null,
          afterValue: investment,
        });

        // Post creditor investment as balance_sheet credit (liability increase)
        await autoPostCreditorInvestment(tx, {
          amount: input.amount,
          investmentId: investment.id,
          investmentDate: input.investmentDate,
          actorId,
          depositLocation: input.depositLocation,
        })

        return investment;
      });
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound")
        return new CreditorNotFound({ id: e.id });
      return new DatabaseError({ cause: e });
    },
  });

export const recordCreditorRepayment = (
  input: RecordCreditorRepaymentInput,
  actorId: string,
): Effect.Effect<CreditorRepayment, InvestmentNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      return await db.transaction(async (tx) => {
        const [investment] = await tx
          .select()
          .from(creditorInvestments)
          .where(eq(creditorInvestments.id, input.investmentId));
        if (!investment)
          throw { _tag: "InvestmentNotFound", id: input.investmentId };
        const existingRepayments = await tx
          .select()
          .from(creditorRepayments)
          .where(eq(creditorRepayments.investmentId, input.investmentId))
          .orderBy(
            asc(creditorRepayments.repaymentDate),
            asc(creditorRepayments.createdAt),
          );

        const prevDate =
          existingRepayments.length === 0
            ? new Date(investment.investmentDate)
            : new Date(
                existingRepayments[existingRepayments.length - 1].repaymentDate,
              );

        const daysElapsed = daysBetween(
          prevDate,
          new Date(input.repaymentDate),
        );

        const allocation = allocatePayment({
          paymentAmount: input.amount,
          principalBalanceBefore: investment.principalBalance,
          monthlyRateDecimal: investment.interestRateMonthly,
          daysElapsed,
          minInterestDays: 0,
        });

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
          .returning();

        await tx
          .update(creditorInvestments)
          .set({
            principalBalance: allocation.principalBalanceAfter,
            updatedAt: new Date(),
          })
          .where(eq(creditorInvestments.id, input.investmentId));

        await writeAuditLog(tx, {
          actorId,
          action: "creditor_repayment.create",
          entityType: "creditor_repayment",
          entityId: repayment.id,
          beforeValue: {
            principalBalance: investment.principalBalance,
          },
          afterValue: repayment,
        });

        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await autoPostInterestExpense(tx, {
            amount: allocation.interestPortion,
            investmentId: input.investmentId,
            repaymentDate: input.repaymentDate,
            actorId,
            sourceLocation: input.sourceLocation,
          });
        }

        // Post creditor principal repaid as balance_sheet debit (liability decrease)
        if (new BigNumber(allocation.principalPortion).isGreaterThan(0)) {
          await autoPostCreditorPrincipalRepaid(tx, {
            amount: allocation.principalPortion,
            investmentId: input.investmentId,
            repaymentDate: input.repaymentDate,
            actorId,
            sourceLocation: input.sourceLocation,
          })
        }

        return repayment;
      });
    },
    catch: (e: any) => {
      if (e?._tag === "InvestmentNotFound")
        return new InvestmentNotFound({ id: e.id });
      return new DatabaseError({ cause: e });
    },
  });

export const getCreditorDashboard = (
  creditorId: string,
): Effect.Effect<CreditorDashboard, CreditorNotFound | DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const [creditor] = await db
        .select()
        .from(creditors)
        .where(eq(creditors.id, creditorId));
      if (!creditor) throw { _tag: "CreditorNotFound", id: creditorId };

      const investments = await db
        .select()
        .from(creditorInvestments)
        .where(eq(creditorInvestments.creditorId, creditorId))
        .orderBy(asc(creditorInvestments.investmentDate));

      const now = new Date();
      let totalInvested = new BigNumber(0);
      let totalInterestAccrued = new BigNumber(0);
      let totalRepaymentsMade = new BigNumber(0);

      const investmentSummaries: CreditorInvestmentSummary[] = [];

      // Batch-fetch all repayments for all investments in a single query
      const investmentIds = investments.map((inv) => inv.id);
      const allRepayments = investmentIds.length > 0
        ? await db
            .select()
            .from(creditorRepayments)
            .where(inArray(creditorRepayments.investmentId, investmentIds))
            .orderBy(
              asc(creditorRepayments.repaymentDate),
              asc(creditorRepayments.createdAt),
            )
        : [];

      // Group repayments by investmentId
      const repaymentsByInvestment = new Map<string, typeof allRepayments>();
      for (const r of allRepayments) {
        const list = repaymentsByInvestment.get(r.investmentId) ?? [];
        list.push(r);
        repaymentsByInvestment.set(r.investmentId, list);
      }

      // Derive per-investment principal balances from ledger
      const ledgerBalances = await getCreditorBalancesFromLedger(investmentIds);

      for (const investment of investments) {
        totalInvested = totalInvested.plus(investment.amount);

        // Use ledger-derived balance, falling back to table field
        const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.principalBalance);

        const repayments = repaymentsByInvestment.get(investment.id) ?? [];

        const totalRepaid = repayments.reduce(
          (acc, r) => acc.plus(r.amount),
          new BigNumber(0),
        );
        totalRepaymentsMade = totalRepaymentsMade.plus(totalRepaid);

        const prevDate =
          repayments.length === 0
            ? new Date(investment.investmentDate)
            : new Date(repayments[repayments.length - 1].repaymentDate);

        const daysElapsed = daysBetween(prevDate, now);

        const interestAccrued = calculateInterest(
          formatAmount(principalBalance),
          investment.interestRateMonthly,
          daysElapsed,
          0,
        );
        totalInterestAccrued = totalInterestAccrued.plus(interestAccrued);

        investmentSummaries.push({
          id: investment.id,
          amount: investment.amount,
          interestRateMonthly: investment.interestRateMonthly,
          investmentDate: new Date(investment.investmentDate),
          principalBalance: formatAmount(principalBalance),
          interestAccrued: formatAmount(interestAccrued),
          totalRepaid: formatAmount(totalRepaid),
        });
      }

      const totalPrincipalBalance = Array.from(ledgerBalances.values()).reduce(
        (acc, bal) => acc.plus(bal),
        new BigNumber(0),
      );
      const outstandingBalance =
        totalPrincipalBalance.plus(totalInterestAccrued);

      return {
        totalInvested: formatAmount(totalInvested),
        interestAccrued: formatAmount(totalInterestAccrued),
        repaymentsMade: formatAmount(totalRepaymentsMade),
        outstandingBalance: formatAmount(outstandingBalance),
        investments: investmentSummaries,
      };
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound")
        return new CreditorNotFound({ id: e.id });
      return new DatabaseError({ cause: e });
    },
  });

export const getSystemCapital = (): Effect.Effect<
  {
    totalInvested: string;
    totalInterestAccrued: string;
    totalRepaymentsMade: string;
    totalOutstanding: string;
  },
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const allInvestments = await db.select().from(creditorInvestments);
      const now = new Date();

      let totalInvested = new BigNumber(0);
      let totalInterestAccrued = new BigNumber(0);
      let totalRepaymentsMade = new BigNumber(0);

      const investmentIds = allInvestments.map((inv) => inv.id);

      // Derive principal balances from ledger
      const ledgerBalances = await getCreditorBalancesFromLedger(investmentIds);

      // Batch-fetch all repayments
      const allRepayments = investmentIds.length > 0
        ? await db
            .select()
            .from(creditorRepayments)
            .where(inArray(creditorRepayments.investmentId, investmentIds))
            .orderBy(asc(creditorRepayments.repaymentDate), asc(creditorRepayments.createdAt))
        : [];

      const repaymentsByInvestment = new Map<string, typeof allRepayments>();
      for (const r of allRepayments) {
        const list = repaymentsByInvestment.get(r.investmentId) ?? [];
        list.push(r);
        repaymentsByInvestment.set(r.investmentId, list);
      }

      for (const investment of allInvestments) {
        totalInvested = totalInvested.plus(investment.amount);

        const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.principalBalance);
        const repayments = repaymentsByInvestment.get(investment.id) ?? [];

        const totalRepaid = repayments.reduce(
          (acc, r) => acc.plus(r.amount),
          new BigNumber(0),
        );
        totalRepaymentsMade = totalRepaymentsMade.plus(totalRepaid);

        const prevDate =
          repayments.length === 0
            ? new Date(investment.investmentDate)
            : new Date(repayments[repayments.length - 1].repaymentDate);

        const daysElapsed = daysBetween(prevDate, now);

        const interestAccrued = calculateInterest(
          formatAmount(principalBalance),
          investment.interestRateMonthly,
          daysElapsed,
          0,
        );
        totalInterestAccrued = totalInterestAccrued.plus(interestAccrued);
      }

      const totalPrincipal = Array.from(ledgerBalances.values()).reduce(
        (acc, bal) => acc.plus(bal),
        new BigNumber(0),
      );
      const totalOutstanding = totalPrincipal.plus(totalInterestAccrued);

      return {
        totalInvested: formatAmount(totalInvested),
        totalInterestAccrued: formatAmount(totalInterestAccrued),
        totalRepaymentsMade: formatAmount(totalRepaymentsMade),
        totalOutstanding: formatAmount(totalOutstanding),
      };
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });
