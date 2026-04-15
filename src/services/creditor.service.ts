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
import { isUniqueConstraintError } from "@/lib/db-errors";
import { writeAuditLog } from "./audit.service";
import { autoPostInterestExpense, autoPostCreditorInvestment, autoPostCreditorPrincipalRepaid } from "@/services/auto-post.service";
import { getCreditorBalancesFromLedger, getInterestPayableFromLedger, getCreditorTotalInvestedFromLedger, getCreditorTotalRepaidFromLedger, getCreditorRepaymentPortionsFromLedger } from "@/services/ledger-queries.service";
import { reverseCreditorInterestAccrual } from "@/services/transaction.service";
import {
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
  MonthlySummaryRow,
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
            ...(input.id ? { id: input.id } : {}),
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
  }).pipe(
    Effect.catchIf(
      (e) => !!input.id && isUniqueConstraintError(e.cause),
      () => createCreditor({ ...input, id: undefined }, actorId)
    )
  );

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
      return await db.select().from(creditors).orderBy(asc(creditors.name)).limit(200);
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
            ...(input.id ? { id: input.id } : {}),
            creditorId: input.creditorId,
            amount: input.amount,
            interestRateMonthly: input.interestRateMonthly,
            investmentDate: new Date(input.investmentDate),
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
  }).pipe(
    Effect.catchIf(
      (e) => e._tag === "DatabaseError" && !!input.id && isUniqueConstraintError(e.cause),
      () => addInvestment({ ...input, id: undefined }, actorId)
    )
  );

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

        // Derive principal balance from ledger (pass tx for transactional consistency)
        const ledgerBalances = await getCreditorBalancesFromLedger([input.investmentId], tx);
        const principalBalance = ledgerBalances.get(input.investmentId) ?? (() => {
          console.warn(`[recordCreditorRepayment] No ledger entries for investment ${input.investmentId}, using amount as fallback`)
          return new BigNumber(investment.amount);
        })();
        const principalBalanceStr = formatAmount(principalBalance);

        const allocation = allocatePayment({
          paymentAmount: input.amount,
          principalBalanceBefore: principalBalanceStr,
          monthlyRateDecimal: investment.interestRateMonthly,
          daysElapsed,
          minInterestDays: 0,
        });

        const [repayment] = await tx
          .insert(creditorRepayments)
          .values({
            ...(input.id ? { id: input.id } : {}),
            investmentId: input.investmentId,
            repaymentDate: new Date(input.repaymentDate),
            amount: input.amount,
            recordedBy: actorId,
          })
          .returning();

        await writeAuditLog(tx, {
          actorId,
          action: "creditor_repayment.create",
          entityType: "creditor_repayment",
          entityId: repayment.id,
          beforeValue: {
            principalBalance: principalBalanceStr,
          },
          afterValue: repayment,
        });

        // Reverse any outstanding creditor interest accrual before posting cash-basis expense
        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await reverseCreditorInterestAccrual(tx, {
            investmentId: input.investmentId,
            repaymentDate: input.repaymentDate,
            actorId,
          })
        }

        if (new BigNumber(allocation.interestPortion).isGreaterThan(0)) {
          await autoPostInterestExpense(tx, {
            amount: allocation.interestPortion,
            investmentId: input.investmentId,
            repaymentId: repayment.id,
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
            repaymentId: repayment.id,
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
  }).pipe(
    Effect.catchIf(
      (e) => e._tag === "DatabaseError" && !!input.id && isUniqueConstraintError(e.cause),
      () => recordCreditorRepayment({ ...input, id: undefined }, actorId)
    )
  );

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

      const investmentSummaries: CreditorInvestmentSummary[] = [];

      const investmentIds = investments.map((inv) => inv.id);

      // Derive all financial figures from the ledger
      const [ledgerBalances, interestPayableMap, totalInvestedBN, totalRepaymentsMadeBN] = await Promise.all([
        getCreditorBalancesFromLedger(investmentIds),
        getInterestPayableFromLedger(investmentIds),
        getCreditorTotalInvestedFromLedger(investmentIds),
        getCreditorTotalRepaidFromLedger(investmentIds),
      ]);

      // Batch-fetch repayment portions from ledger for per-investment repaid totals
      const allRepayments = investmentIds.length > 0
        ? await db
            .select()
            .from(creditorRepayments)
            .where(inArray(creditorRepayments.investmentId, investmentIds))
        : [];

      const repaymentAmountsByInvestment = new Map<string, BigNumber>();
      for (const r of allRepayments) {
        const current = repaymentAmountsByInvestment.get(r.investmentId) ?? new BigNumber(0);
        repaymentAmountsByInvestment.set(r.investmentId, current.plus(r.amount));
      }

      let totalInterestAccrued = new BigNumber(0);

      for (const investment of investments) {
        if (!ledgerBalances.has(investment.id)) {
          console.warn(`[getCreditorDashboard] No ledger entries for investment ${investment.id}, using amount as fallback`)
        }
        const principalBalance = ledgerBalances.get(investment.id) ?? new BigNumber(investment.amount);
        const interestAccrued = interestPayableMap.get(investment.id) ?? new BigNumber(0);
        totalInterestAccrued = totalInterestAccrued.plus(interestAccrued);
        const totalRepaid = repaymentAmountsByInvestment.get(investment.id) ?? new BigNumber(0);

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
        totalInvested: formatAmount(totalInvestedBN),
        interestAccrued: formatAmount(totalInterestAccrued),
        repaymentsMade: formatAmount(totalRepaymentsMadeBN),
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

      const investmentIds = allInvestments.map((inv) => inv.id);

      // Derive all financial figures from the ledger
      const [ledgerBalances, interestPayableMap, totalInvestedBN, totalRepaymentsMadeBN] = await Promise.all([
        getCreditorBalancesFromLedger(investmentIds),
        getInterestPayableFromLedger(investmentIds),
        getCreditorTotalInvestedFromLedger(investmentIds),
        getCreditorTotalRepaidFromLedger(investmentIds),
      ]);

      let totalInterestAccrued = new BigNumber(0);
      for (const investment of allInvestments) {
        const interestAccrued = interestPayableMap.get(investment.id) ?? new BigNumber(0);
        totalInterestAccrued = totalInterestAccrued.plus(interestAccrued);
      }

      const totalPrincipal = Array.from(ledgerBalances.values()).reduce(
        (acc, bal) => acc.plus(bal),
        new BigNumber(0),
      );
      const totalOutstanding = totalPrincipal.plus(totalInterestAccrued);

      return {
        totalInvested: formatAmount(totalInvestedBN),
        totalInterestAccrued: formatAmount(totalInterestAccrued),
        totalRepaymentsMade: formatAmount(totalRepaymentsMadeBN),
        totalOutstanding: formatAmount(totalOutstanding),
      };
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

/**
 * For each creditor, compute the monthly interest due:
 * Sum of (principal_balance × monthly_rate) across all their investments.
 * Returns Map<creditorId, formatted string>.
 */
export const getCreditorMonthlyInterestDue = (): Effect.Effect<
  Map<string, string>,
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const allInvestments = await db.select().from(creditorInvestments);
      if (allInvestments.length === 0) return new Map<string, string>();

      const investmentIds = allInvestments.map((inv) => inv.id);
      const ledgerBalances = await getCreditorBalancesFromLedger(investmentIds);

      const dueByCreditor = new Map<string, BigNumber>();

      for (const investment of allInvestments) {
        const principalBalance =
          ledgerBalances.get(investment.id) ?? new BigNumber(investment.amount);

        if (principalBalance.isLessThanOrEqualTo(0)) continue;

        const monthlyRate = new BigNumber(investment.interestRateMonthly);
        const monthlyInterest = principalBalance.times(monthlyRate);

        const current =
          dueByCreditor.get(investment.creditorId) ?? new BigNumber(0);
        dueByCreditor.set(
          investment.creditorId,
          current.plus(monthlyInterest),
        );
      }

      const result = new Map<string, string>();
      for (const [creditorId, amount] of dueByCreditor) {
        result.set(creditorId, formatAmount(amount));
      }
      return result;
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

/**
 * Combined query for the creditors list page.
 * Fetches creditors, system capital, and monthly interest due in a single
 * server action call, sharing the investments fetch and ledger queries
 * to eliminate duplicate DB round-trips.
 */
export const getCreditorsPageData = (): Effect.Effect<
  {
    creditors: Creditor[];
    capital: {
      totalInvested: string;
      totalInterestAccrued: string;
      totalRepaymentsMade: string;
      totalOutstanding: string;
    };
    monthlyDue: Record<string, string>;
  },
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      // Fetch creditors and all investments in parallel (independent)
      const [creditorsList, allInvestments] = await Promise.all([
        db.select().from(creditors).orderBy(asc(creditors.name)).limit(200),
        db.select().from(creditorInvestments),
      ]);

      if (allInvestments.length === 0) {
        return {
          creditors: creditorsList,
          capital: {
            totalInvested: "0.00",
            totalInterestAccrued: "0.00",
            totalRepaymentsMade: "0.00",
            totalOutstanding: "0.00",
          },
          monthlyDue: {},
        };
      }

      const investmentIds = allInvestments.map((inv) => inv.id);

      // Single Promise.all for all ledger queries (no duplicates)
      const [ledgerBalances, interestPayableMap, totalInvestedBN, totalRepaymentsMadeBN] = await Promise.all([
        getCreditorBalancesFromLedger(investmentIds),
        getInterestPayableFromLedger(investmentIds),
        getCreditorTotalInvestedFromLedger(investmentIds),
        getCreditorTotalRepaidFromLedger(investmentIds),
      ]);

      // --- System capital ---
      let totalInterestAccrued = new BigNumber(0);
      for (const investment of allInvestments) {
        const interestAccrued = interestPayableMap.get(investment.id) ?? new BigNumber(0);
        totalInterestAccrued = totalInterestAccrued.plus(interestAccrued);
      }
      const totalPrincipal = Array.from(ledgerBalances.values()).reduce(
        (acc, bal) => acc.plus(bal),
        new BigNumber(0),
      );
      const totalOutstanding = totalPrincipal.plus(totalInterestAccrued);

      // --- Monthly interest due (reuses ledgerBalances) ---
      const dueByCreditor = new Map<string, BigNumber>();
      for (const investment of allInvestments) {
        const principalBalance =
          ledgerBalances.get(investment.id) ?? new BigNumber(investment.amount);
        if (principalBalance.isLessThanOrEqualTo(0)) continue;
        const monthlyRate = new BigNumber(investment.interestRateMonthly);
        const monthlyInterest = principalBalance.times(monthlyRate);
        const current = dueByCreditor.get(investment.creditorId) ?? new BigNumber(0);
        dueByCreditor.set(investment.creditorId, current.plus(monthlyInterest));
      }
      const monthlyDue: Record<string, string> = {};
      for (const [creditorId, amount] of dueByCreditor) {
        monthlyDue[creditorId] = formatAmount(amount);
      }

      return {
        creditors: creditorsList,
        capital: {
          totalInvested: formatAmount(totalInvestedBN),
          totalInterestAccrued: formatAmount(totalInterestAccrued),
          totalRepaymentsMade: formatAmount(totalRepaymentsMadeBN),
          totalOutstanding: formatAmount(totalOutstanding),
        },
        monthlyDue,
      };
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

/**
 * Build a month-by-month summary for a single creditor.
 * Walks from earliest investment month to current month.
 * Each row: interest due, interest paid, principal paid, total paid, remaining balance.
 */
export const getCreditorMonthlySummary = (
  creditorId: string,
): Effect.Effect<MonthlySummaryRow[], CreditorNotFound | DatabaseError> =>
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

      if (investments.length === 0) return [];

      // Fetch all repayments for this creditor's investments
      const investmentIds = investments.map((inv) => inv.id);
      const allRepayments = await db
        .select()
        .from(creditorRepayments)
        .where(inArray(creditorRepayments.investmentId, investmentIds))
        .orderBy(asc(creditorRepayments.repaymentDate));

      // Get interest/principal portions for each repayment from ledger
      const portionsMap =
        allRepayments.length > 0
          ? await getCreditorRepaymentPortionsFromLedger(
              allRepayments.map((r) => r.id),
            )
          : new Map<
              string,
              { interestPortion: string; principalPortion: string }
            >();

      // Group repayments by month (YYYY-MM)
      const repaymentsByMonth = new Map<
        string,
        { interestPaid: BigNumber; principalPaid: BigNumber }
      >();
      for (const repayment of allRepayments) {
        const date = new Date(repayment.repaymentDate);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const current = repaymentsByMonth.get(monthKey) ?? {
          interestPaid: new BigNumber(0),
          principalPaid: new BigNumber(0),
        };
        const portions = portionsMap.get(repayment.id);
        if (portions) {
          current.interestPaid = current.interestPaid.plus(
            portions.interestPortion,
          );
          current.principalPaid = current.principalPaid.plus(
            portions.principalPortion,
          );
        } else {
          // Fallback: treat entire amount as principal
          current.principalPaid = current.principalPaid.plus(repayment.amount);
        }
        repaymentsByMonth.set(monthKey, current);
      }

      // Track investment info for month-walking
      interface InvestmentInfo {
        id: string;
        amount: BigNumber;
        rate: BigNumber;
        startMonth: string;
      }
      const investmentInfos: InvestmentInfo[] = investments.map((inv) => {
        const d = new Date(inv.investmentDate);
        return {
          id: inv.id,
          amount: new BigNumber(inv.amount),
          rate: new BigNumber(inv.interestRateMonthly),
          startMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        };
      });

      // Determine month range
      const earliestDate = new Date(investments[0].investmentDate);
      const startYear = earliestDate.getFullYear();
      const startMonth = earliestDate.getMonth(); // 0-indexed
      const now = new Date();
      const endYear = now.getFullYear();
      const endMonth = now.getMonth();

      // Walk month by month
      const rows: MonthlySummaryRow[] = [];
      const balances = new Map<string, BigNumber>();

      let year = startYear;
      let month = startMonth;

      while (year < endYear || (year === endYear && month <= endMonth)) {
        const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

        // Activate new investments this month
        for (const info of investmentInfos) {
          if (info.startMonth === monthKey && !balances.has(info.id)) {
            balances.set(info.id, info.amount);
          }
        }

        // Calculate interest due this month
        let interestDue = new BigNumber(0);
        for (const info of investmentInfos) {
          const bal = balances.get(info.id);
          if (bal && bal.isGreaterThan(0)) {
            interestDue = interestDue.plus(bal.times(info.rate));
          }
        }

        // Get repayments for this month
        const monthRepayments = repaymentsByMonth.get(monthKey) ?? {
          interestPaid: new BigNumber(0),
          principalPaid: new BigNumber(0),
        };

        // Reduce principal balances proportionally
        let totalPrincipalPaid = monthRepayments.principalPaid;
        if (totalPrincipalPaid.isGreaterThan(0)) {
          const totalBalance = Array.from(balances.values()).reduce(
            (acc, b) => acc.plus(b),
            new BigNumber(0),
          );
          if (totalBalance.isGreaterThan(0)) {
            for (const [invId, bal] of balances) {
              const share = bal.div(totalBalance);
              const reduction = totalPrincipalPaid.times(share);
              balances.set(invId, BigNumber.max(bal.minus(reduction), new BigNumber(0)));
            }
          }
        }

        const totalRemainingBalance = Array.from(balances.values()).reduce(
          (acc, b) => acc.plus(b),
          new BigNumber(0),
        );

        const totalPaid = monthRepayments.interestPaid.plus(
          monthRepayments.principalPaid,
        );

        rows.push({
          month: monthKey,
          interestDue: formatAmount(interestDue),
          interestPaid: formatAmount(monthRepayments.interestPaid),
          principalPaid: formatAmount(monthRepayments.principalPaid),
          totalPaid: formatAmount(totalPaid),
          remainingBalance: formatAmount(totalRemainingBalance),
        });

        // Advance month
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }

      // Return newest first
      return rows.reverse();
    },
    catch: (e: any) => {
      if (e?._tag === "CreditorNotFound")
        return new CreditorNotFound({ id: e.id });
      return new DatabaseError({ cause: e });
    },
  });
