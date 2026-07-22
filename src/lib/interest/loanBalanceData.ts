"use server";

import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../db";
import { loans, payments } from "../db/schema";
import { computeLoanOverdueInfo } from "./overdue";
import { getBaseRate } from "./effective-rate";
import { toLoanType } from "@/types";
import { formatAmount } from "./engine";
import {
  getInterestEarnedFromLedger,
  getLoanBalancesFromLedger,
  getRemainingPrincipalFromLedger,
} from "@/services/ledger-queries.service";
import BigNumber from "bignumber.js";
import { getLastSettlementEventsForLoans } from "@/services/settlement.service";
import { isOperationalLoan } from "@/lib/loan-visibility";

type QueryDb = Pick<typeof db, "select">;

type BalanceInfo = ReturnType<typeof computeLoanOverdueInfo> & {
  totalBalanceOwed: string;
  loanId: string;
  lastPaymentDate: Date;
  remainingPrincipalAmount: string;
};

function zeroedBalanceInfo(
  loanId: string,
  lastPaymentDate: Date,
): BalanceInfo {
  return {
    daysOverdue: 0,
    dailyRate: "0",
    unpaidInterest: "0",
    penaltyActive: false,
    effectiveRate: "0",
    totalBalanceOwed: "0",
    lastPaymentDate,
    loanId,
    remainingPrincipalAmount: "0",
  };
}

export async function computeSingleLoanBalanceData(
  loanId: string,
  asOf: Date,
  queryDb: QueryDb = db,
) {
  return (await computeLoanBalanceData([loanId], asOf, queryDb)).get(loanId)!;
}

export async function computeAllLoansBalanceData() {
  const loanData = await db.query.loans.findMany({
    where: isNull(loans.deletedAt),
    columns: { id: true },
    orderBy: (loans, { desc }) => desc(loans.createdAt),
  });
  const loanIds = loanData.map((data) => data.id);

  return computeLoanBalanceDataArray(loanIds, new Date());
}
export async function computeLoanBalanceDataArray(
  loanIds: string[],
  asOf: Date,
) {
  return Array.from((await computeLoanBalanceData(loanIds, asOf)).values());
}

/**
 * Path A balance feed for loanBalanceCollection.
 * Non-operational loans return zeros without payment/ledger IO (R11-1 / R19-3).
 * Rows are still emitted so historical detail joins keep working.
 *
 * Pass `queryDb` (e.g. transaction handle) so in-flight journal rows are visible.
 */
export async function computeLoanBalanceData(
  loanIds: string[],
  asOf: Date,
  queryDb: QueryDb = db,
) {
  const results: Map<string, BalanceInfo> = new Map();
  if (loanIds.length === 0) return results;

  const loansFromDb = await queryDb
    .select()
    .from(loans)
    .where(and(inArray(loans.id, loanIds), isNull(loans.deletedAt)));

  const operational = loansFromDb.filter((loan) =>
    isOperationalLoan(loan.status),
  );
  const historical = loansFromDb.filter(
    (loan) => !isOperationalLoan(loan.status),
  );

  for (const loan of historical) {
    results.set(
      loan.id,
      zeroedBalanceInfo(loan.id, new Date(loan.startDate)),
    );
  }

  const operationalIds = operational.map((loan) => loan.id);
  if (operationalIds.length === 0) return results;

  const [
    remainingPrincipalbalanceMap,
    balanceMap,
    interestEarnedMap,
    settlementEvents,
    allPayments,
  ] = await Promise.all([
    getRemainingPrincipalFromLedger(operationalIds, asOf, queryDb),
    getLoanBalancesFromLedger(operationalIds, asOf, queryDb),
    getInterestEarnedFromLedger(operationalIds, asOf, queryDb),
    getLastSettlementEventsForLoans(operationalIds, asOf, queryDb),
    queryDb
      .select()
      .from(payments)
      .where(
        and(
          inArray(payments.loanId, operationalIds),
          isNull(payments.deletedAt),
          eq(payments.markedWrong, false),
          lte(payments.paymentDate, asOf),
        ),
      )
      .orderBy(asc(payments.paymentDate), asc(payments.createdAt)),
  ]);

  const paymentsByLoanId = new Map<string, typeof allPayments>();
  for (const p of allPayments) {
    const list = paymentsByLoanId.get(p.loanId) ?? [];
    list.push(p);
    paymentsByLoanId.set(p.loanId, list);
  }

  for (const loan of operational) {
    const activePayments = paymentsByLoanId.get(loan.id) ?? [];
    const hasLedgerEntries = balanceMap.has(loan.id);
    const ledgerBalance = balanceMap.get(loan.id) ?? new BigNumber(0);
    if (!hasLedgerEntries) {
      console.warn(
        `[getLoanBalanceSummary] No ledger entries for loan ${loan.id}, using principalAmount as fallback`,
      );
    }
    const totalBalanceOwed = hasLedgerEntries
      ? ledgerBalance.toFixed(0)
      : loan.principalAmount;
    const remainingPrincipalbalance =
      remainingPrincipalbalanceMap.get(loan.id) ?? BigNumber(0);

    const baseRate = getBaseRate(loan);
    const loanType = toLoanType(loan.loanType);
    const totalInterestPaid = formatAmount(
      interestEarnedMap.get(loan.id) ?? new BigNumber(0),
    );
    const lastPaymentDate =
      settlementEvents.get(loan.id)?.date ?? new Date(loan.startDate);

    const info = computeLoanOverdueInfo({
      principalAmount: loan.principalAmount,
      baseRate,
      startDate: new Date(loan.startDate),
      loanType,
      termMonths: loan.termMonths,
      totalInterestPaid,
      paymentCount: activePayments.length,
      totalBalanceOwed,
      penaltyWaived: loan.penaltyWaived,
      loan,
      lastPaymentDate,
      asOf,
    });

    results.set(loan.id, {
      ...info,
      totalBalanceOwed,
      lastPaymentDate,
      loanId: loan.id,
      remainingPrincipalAmount: formatAmount(remainingPrincipalbalance),
    });
  }

  return results;
}
