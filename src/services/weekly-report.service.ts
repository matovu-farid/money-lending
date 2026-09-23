import BigNumber from "bignumber.js";
import { Effect } from "effect";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { DatabaseError } from "@/lib/errors";
import { parseWeeklyReportPeriod } from "@/lib/weekly-report-period";
import { computeLoanBalanceData } from "@/lib/interest/loanBalanceData";
import { getPaymentPortionsFromLedger } from "@/services/ledger-queries.service";
import { customers } from "@/lib/db/schema/customers";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import type { WeeklyLoansReportData, WeeklyPaymentsReportData } from "@/types/weekly-report";

export const getWeeklyPaymentsData = (
  week: string,
): Effect.Effect<WeeklyPaymentsReportData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const calculatedAt = new Date();
      const { startUtc, endUtc } = parseWeeklyReportPeriod(week);
      const rows = await db
        .select({
          id: payments.id,
          loanId: loans.id,
          customerName: customers.fullName,
          contactNumber: customers.contact,
          paymentDate: payments.paymentDate,
          amount: payments.amount,
          depositLocation: payments.depositLocation,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .innerJoin(loans, eq(payments.loanId, loans.id))
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(and(
          gte(payments.paymentDate, startUtc),
          lt(payments.paymentDate, endUtc),
          isNull(payments.deletedAt),
          eq(payments.markedWrong, false),
          isNull(loans.deletedAt),
          ne(loans.status, "pending"),
        ))
        .orderBy(desc(payments.paymentDate), desc(payments.id));

      const loanIds = [...new Set(rows.map((row) => row.loanId))];
      const allPayments = loanIds.length
        ? await db
            .select({ id: payments.id, loanId: payments.loanId })
            .from(payments)
            .where(and(
              inArray(payments.loanId, loanIds),
              isNull(payments.deletedAt),
              eq(payments.markedWrong, false),
            ))
            .orderBy(asc(payments.paymentDate), asc(payments.createdAt), asc(payments.id))
        : [];
      const principalRows = loanIds.length
        ? await db
            .select({ id: loans.id, principalAmount: loans.principalAmount })
            .from(loans)
            .where(inArray(loans.id, loanIds))
        : [];
      const principalByLoan = new Map(
        principalRows.map((loan) => [loan.id, new BigNumber(loan.principalAmount)]),
      );
      const portions = await getPaymentPortionsFromLedger(allPayments.map((row) => row.id));
      const principalAfterByPayment = new Map<string, string>();
      for (const payment of allPayments) {
        const principal = principalByLoan.get(payment.loanId) ?? new BigNumber(0);
        const allocation = portions.get(payment.id);
        const nextPrincipal = allocation
          ? BigNumber.max(principal.minus(allocation.principalPortion), 0)
          : principal;
        principalByLoan.set(payment.loanId, nextPrincipal);
        principalAfterByPayment.set(payment.id, nextPrincipal.toFixed(0));
      }

      const weeklyPortions = rows.map((row) => portions.get(row.id));
      const total = rows.reduce((sum, row) => sum.plus(row.amount), new BigNumber(0));
      return {
        week,
        calculatedAt: calculatedAt.toISOString(),
        count: rows.length,
        total: total.toFixed(2),
        rows: rows.map((row, index) => ({
          id: row.id,
          loanId: row.loanId,
          customerName: row.customerName,
          contactNumber: row.contactNumber,
          paymentDate: row.paymentDate.toISOString(),
          amount: row.amount,
          interestPortion: weeklyPortions[index]?.interestPortion ?? "0.00",
          principalPortion: weeklyPortions[index]?.principalPortion ?? "0.00",
          principalBalanceAfter: principalAfterByPayment.get(row.id) ?? "0.00",
          depositLocation: row.depositLocation,
        })),
      };
    },
    catch: (cause) => new DatabaseError({ cause }),
  });

export const getWeeklyLoansData = (
  week: string,
): Effect.Effect<WeeklyLoansReportData, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const calculatedAt = new Date();
      const { startUtc, endUtc } = parseWeeklyReportPeriod(week);
      const rows = await db
        .select({
          id: loans.id,
          customerId: customers.id,
          customerName: customers.fullName,
          contactNumber: customers.contact,
          startDate: loans.startDate,
          status: loans.status,
          principalAmount: loans.principalAmount,
        })
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(and(
          gte(loans.startDate, startUtc),
          lt(loans.startDate, endUtc),
          isNull(loans.deletedAt),
          ne(loans.status, "pending"),
        ))
        .orderBy(desc(loans.startDate), desc(loans.id));

      const balances = await computeLoanBalanceData(rows.map((row) => row.id), calculatedAt);
      const total = rows.reduce((sum, row) => sum.plus(row.principalAmount), new BigNumber(0));
      return {
        week,
        calculatedAt: calculatedAt.toISOString(),
        count: rows.length,
        total: total.toFixed(2),
        rows: rows.map((row) => {
          const balance = balances.get(row.id);
          const principalBalance = balance?.totalBalanceOwed ?? row.principalAmount;
          const accruedInterest = balance?.unpaidInterest ?? "0.00";
          return {
            ...row,
            startDate: row.startDate.toISOString(),
            principalBalance,
            accruedInterest,
            totalDue: new BigNumber(principalBalance).plus(accruedInterest).toFixed(2),
            daysOverdue: balance?.daysOverdue ?? 0,
            lastPaymentDate: (balance?.lastPaymentDate ?? row.startDate).toISOString(),
          };
        }),
      };
    },
    catch: (cause) => new DatabaseError({ cause }),
  });
