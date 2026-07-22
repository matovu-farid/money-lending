import { Effect } from "effect";
import { db } from "@/lib/db";
import { payments } from "@/lib/db/schema/payments";
import { loans } from "@/lib/db/schema/loans";
import { customers } from "@/lib/db/schema/customers";
import { getBaseRate } from "@/lib/interest/effective-rate";
import { sql, eq, and, isNull, asc, inArray } from "drizzle-orm";
import { DatabaseError } from "@/lib/errors";
import BigNumber from "bignumber.js";
import { computeLoanOverdueInfo } from "@/lib/interest/overdue";
import { getPaymentPortionsFromLedger } from "@/services/ledger-queries.service";
import {
  toLoanType,
  type DailyCollectionsSummary,
  type DailyCollectionRow,
  type LoanDueToday,
} from "@/types";
import { computeLoanBalanceData } from "@/lib/interest/loanBalanceData";

export const getDailyCollections = (
  date: string,
): Effect.Effect<DailyCollectionsSummary, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db
        .select({
          paymentId: payments.id,
          loanId: payments.loanId,
          customerName: customers.fullName,
          amount: payments.amount,
          paymentDate: payments.paymentDate,
          depositLocation: payments.depositLocation,
        })
        .from(payments)
        .innerJoin(loans, eq(payments.loanId, loans.id))
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(
          and(
            isNull(payments.deletedAt),
            eq(payments.markedWrong, false),
            sql`DATE(${payments.paymentDate} AT TIME ZONE 'Africa/Kampala') = ${date}::date`,
          ),
        )
        .orderBy(asc(payments.paymentDate));

      // Enrich with ledger-derived portions
      const paymentIds = rows.map((r) => r.paymentId);
      const portions =
        paymentIds.length > 0
          ? await getPaymentPortionsFromLedger(paymentIds)
          : new Map<
              string,
              { interestPortion: string; principalPortion: string }
            >();

      // Derive totalCollected from ledger (sum of interest + principal portions)
      const totalCollected = rows
        .reduce((sum, r) => {
          const portion = portions.get(r.paymentId);
          if (portion) {
            return sum
              .plus(portion.interestPortion)
              .plus(portion.principalPortion);
          }
          // Fallback for payments without ledger entries (should not happen)
          console.warn(
            `[getDailyCollections] No ledger entries for payment ${r.paymentId}`,
          );
          return sum.plus(r.amount);
        }, new BigNumber(0))
        .toFixed(0);

      const enrichedRows: DailyCollectionRow[] = rows.map((r) => {
        const portion = portions.get(r.paymentId);
        return {
          ...r,
          interestPortion: portion?.interestPortion ?? "0.00",
          principalPortion: portion?.principalPortion ?? "0.00",
        };
      });

      return {
        date,
        totalCollected,
        paymentCount: rows.length,
        rows: enrichedRows,
      };
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });

export const getLoansDueToday = (): Effect.Effect<
  LoanDueToday[],
  DatabaseError
> =>
  Effect.tryPromise({
    try: async () => {
      const activeLoans = await db
        .select({
          id: loans.id,
          customerId: loans.customerId,
          principalAmount: loans.principalAmount,
          startDate: loans.startDate,
          interestRate: loans.interestRate,
          interestRateOverride: loans.interestRateOverride,
          penaltyWaived: loans.penaltyWaived,
          penaltyMultiplier: loans.penaltyMultiplier,
          loanType: loans.loanType,
          termMonths: loans.termMonths,
          customerName: customers.fullName,
        })
        .from(loans)
        .innerJoin(customers, eq(loans.customerId, customers.id))
        .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)));

      if (activeLoans.length === 0) return [];

      const loanIds = activeLoans.map((l) => l.id);

      // Batch-fetch payments and ledger balances
      const allPayments = await db
        .select()
        .from(payments)
        .where(
          and(
            inArray(payments.loanId, loanIds),
            isNull(payments.deletedAt),
            eq(payments.markedWrong, false),
          ),
        )
        .orderBy(asc(payments.paymentDate));

      const paymentsByLoanId = new Map<
        string,
        (typeof allPayments)[number][]
      >();
      for (const p of allPayments) {
        const existing = paymentsByLoanId.get(p.loanId) ?? [];
        existing.push(p);
        paymentsByLoanId.set(p.loanId, existing);
      }

      const results: LoanDueToday[] = [];
      const loanMap = await computeLoanBalanceData(loanIds, new Date());

      for (const loan of activeLoans) {
        const info = loanMap.get(loan.id)!;
        const daysOverdue = info.daysOverdue;

        if (daysOverdue >= 30) {
          results.push({
            loanId: loan.id,
            customerId: loan.customerId,
            customerName: loan.customerName,
            loanAmount: loan.principalAmount,
            outstandingBalance: info.totalBalanceOwed,
            daysOverdue,
            lastPaymentDate: info.lastPaymentDate,
          });
        }
      }

      results.sort((a, b) => b.daysOverdue - a.daysOverdue);
      return results;
    },
    catch: (e) => new DatabaseError({ cause: e }),
  });
