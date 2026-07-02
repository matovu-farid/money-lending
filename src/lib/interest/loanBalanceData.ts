"use server";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
import { getLastPaymentDate } from "@/services/payment.service";

type BalanceInfo = ReturnType<typeof computeLoanOverdueInfo> & {
  totalBalanceOwed: string;
  loanId: string;
  lastPaymentDate: Date;
  remainingPrincipalAmount: string;
};

export async function computeSingleLoanBalanceData(loanId: string, asOf: Date) {
  return (await computeLoanBalanceData([loanId], asOf)).get(loanId)!;
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
export async function getTotalInterestPaid(loanId: string) {
  const interestEarnedMap = await getInterestEarnedFromLedger([loanId]);
  return formatAmount(interestEarnedMap.get(loanId) ?? new BigNumber(0));
}
export async function computeLoanBalanceData(loanIds: string[], asOf: Date) {
  const loansFromDb = await db.query.loans.findMany({
    where: and(inArray(loans.id, loanIds), isNull(loans.deletedAt)),
  });
  const results: Map<string, BalanceInfo> = new Map();
  const remainingPrincipalbalanceMap =
    await getRemainingPrincipalFromLedger(loanIds);

  const balanceMap = await getLoanBalancesFromLedger(loanIds);
  const promises = loansFromDb.map(async (loan) => {
    const activePayments = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.loanId, loan.id),
          isNull(payments.deletedAt),
          eq(payments.markedWrong, false),
        ),
      )
      .orderBy(asc(payments.paymentDate), asc(payments.createdAt));
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
    const totalInterestPaid = await getTotalInterestPaid(loan.id);

    const info = computeLoanOverdueInfo({
      principalAmount: loan.principalAmount,
      baseRate,
      startDate: new Date(loan.startDate),
      loanType,
      termMonths: loan.termMonths,
      totalInterestPaid: totalInterestPaid,
      paymentCount: activePayments.length,
      totalBalanceOwed: totalBalanceOwed,
      penaltyWaived: loan.penaltyWaived,
      loan,
      lastPaymentDate: await getLastPaymentDate(loan),
      asOf,
    });

    results.set(loan.id, {
      ...info,
      totalBalanceOwed: totalBalanceOwed,
      lastPaymentDate: await getLastPaymentDate(loan),
      loanId: loan.id,
      remainingPrincipalAmount: formatAmount(remainingPrincipalbalance),
    });
  });
  await Promise.all(promises);

  return results;
}
