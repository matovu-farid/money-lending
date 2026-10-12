"use server";

import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../db";
import { auditLog, loans, loanWaivers, payments } from "../db/schema";
import { computeLoanOverdueInfo } from "./overdue";
import { getBaseRate, getEffectiveRate } from "./effective-rate";
import { toLoanType } from "@/types";
import { formatAmount } from "./engine";
import {
  getInterestEarnedFromLedger,
  getLoanBalancesFromLedger,
  getPaymentPortionsFromLedger,
  getRolloverInterestSettledFromLedger,
  getWaiverPortionsFromLedger,
  getRemainingPrincipalFromLedger,
} from "@/services/ledger-queries.service";
import BigNumber from "bignumber.js";
import { getLastSettlementEventsForLoans } from "@/services/settlement.service";
import { isOperationalLoan } from "@/lib/loan-visibility";
import { buildLoanStatement } from "@/lib/loan-statement";
import { captureServerWarning } from "@/lib/sentry";

type QueryDb = Pick<typeof db, "select">;

export type LoanBalanceDataOptions = {
  /** Treat these loans as operational while calculating their balance. */
  forceOperationalLoanIds?: readonly string[];
};

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
  options: LoanBalanceDataOptions = {},
) {
  return (
    await computeLoanBalanceData([loanId], asOf, queryDb, options)
  ).get(loanId)!;
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
  options: LoanBalanceDataOptions = {},
) {
  const results: Map<string, BalanceInfo> = new Map();
  if (loanIds.length === 0) return results;

  const loansFromDb = await queryDb
    .select()
    .from(loans)
    .where(and(inArray(loans.id, loanIds), isNull(loans.deletedAt)));

  const forcedOperationalLoanIds = new Set(
    options.forceOperationalLoanIds ?? [],
  );
  const operational = loansFromDb.filter(
    (loan) =>
      forcedOperationalLoanIds.has(loan.id) || isOperationalLoan(loan.status),
  );
  const historical = loansFromDb.filter(
    (loan) =>
      !forcedOperationalLoanIds.has(loan.id) &&
      !isOperationalLoan(loan.status),
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
    allWaivers,
    rolloverInterestMap,
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
    queryDb
      .select()
      .from(loanWaivers)
      .where(
        and(
          inArray(loanWaivers.loanId, operationalIds),
          isNull(loanWaivers.deletedAt),
          lte(loanWaivers.waiverDate, asOf),
        ),
      )
      .orderBy(asc(loanWaivers.waiverDate)),
    getRolloverInterestSettledFromLedger
      ? getRolloverInterestSettledFromLedger(operationalIds, asOf, queryDb)
      : Promise.resolve(new Map<string, BigNumber>()),
  ]);

  const paymentsByLoanId = new Map<string, typeof allPayments>();
  for (const p of allPayments) {
    const list = paymentsByLoanId.get(p.loanId) ?? [];
    list.push(p);
    paymentsByLoanId.set(p.loanId, list);
  }

  // Payment allocations are the cash interest actually paid. The balance
  // feed needs them to distinguish cumulative accrued interest from interest
  // settled by payments; using only the latest payment date drops older
  // unpaid interest from the amount due.
  const paymentPortions = getPaymentPortionsFromLedger
    ? await getPaymentPortionsFromLedger(
        allPayments.map((p) => p.id),
        queryDb,
      )
    : new Map<string, { interestPortion: string; principalPortion: string }>();
  const waiverPortions = getWaiverPortionsFromLedger
    ? await getWaiverPortionsFromLedger(
        allWaivers.map((w) => w.id),
        queryDb,
      )
    : new Map<string, { interestPortion: string; principalPortion: string }>();

  // Legacy fixed/reducing loans can have unmarked, time-effective rate edits.
  // Only newly marked retroactive corrections use their statement accrual path;
  // otherwise preserve the pre-existing balance calculation for those loans.
  // The marker also makes missing allocations a hard error on corrected loans.
  const overriddenLoans = operational.filter((loan) => loan.interestRateOverride !== null);
  const overriddenIds = overriddenLoans.map((loan) => loan.id);
  const startDateByLoanId = new Map(overriddenLoans.map((loan) => [loan.id, loan.startDate.toISOString()]));
  const correctedLoanIds = new Set<string>();
  if (overriddenIds.length > 0) {
    const audits = await queryDb.select({
      entityId: auditLog.entityId,
      afterValue: auditLog.afterValue,
    }).from(auditLog).where(and(
      eq(auditLog.entityType, "loan"),
      inArray(auditLog.entityId, overriddenIds),
      inArray(auditLog.action, [
        "loan.rate_change.immediate",
        "loan.rate_change.approved",
        "loan.rate_change.admin_adjusted",
        "historical_rate_corrected_by_agent",
      ]),
    ));
    for (const audit of audits) {
      if (!audit.afterValue) continue;
      try {
        const after = JSON.parse(audit.afterValue) as Record<string, unknown>;
        if (after.rateSemantics === "correction" &&
            after.effectiveFrom === startDateByLoanId.get(audit.entityId)) {
          correctedLoanIds.add(audit.entityId);
        }
      } catch {
        // An unreadable legacy audit is not evidence of a retroactive correction.
      }
    }
  }

  const waiversByLoanId = new Map<string, typeof allWaivers>();
  for (const w of allWaivers) {
    const list = waiversByLoanId.get(w.loanId) ?? [];
    list.push(w);
    waiversByLoanId.set(w.loanId, list);
  }

  for (const loan of operational) {
    const activePayments = paymentsByLoanId.get(loan.id) ?? [];
    const activeWaivers = waiversByLoanId.get(loan.id) ?? [];
    const hasLedgerEntries = balanceMap.has(loan.id);
    const ledgerBalance = balanceMap.get(loan.id) ?? new BigNumber(0);
    if (!hasLedgerEntries) {
      captureServerWarning("Loan balance ledger entries missing; using principal fallback", {
        source: "loan-balance.missing-ledger",
      });
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
    // Interest Earned includes predecessor interest capitalized at rollover.
    // That amount is already in this loan's principal, so it cannot also
    // reduce interest accrued on the successor.
    const legacyInterestPaid = formatAmount(
      BigNumber.max(
        (interestEarnedMap.get(loan.id) ?? new BigNumber(0)).minus(
          rolloverInterestMap.get(loan.id) ?? new BigNumber(0),
        ),
        0,
      ),
    );
    const hasAllPaymentPortions = activePayments.every((payment) =>
      paymentPortions.has(payment.id),
    );
    const hasAllWaiverPortions = activeWaivers.every((waiver) =>
      waiverPortions.has(waiver.id),
    );
    if (correctedLoanIds.has(loan.id) && (!hasAllPaymentPortions || !hasAllWaiverPortions)) {
      throw new Error("Corrected loan has an unreconciled settlement allocation");
    }
    // Use the same penalty-aware accrual timeline as statements and journal
    // reconciliation for every loan type. A separate fixed/reducing estimate
    // can disagree with a retroactive correction after the penalty threshold.
    const statement =
      hasAllPaymentPortions && hasAllWaiverPortions &&
      (loanType === "perpetual" || correctedLoanIds.has(loan.id))
        ? buildLoanStatement({
            loan: {
              id: loan.id,
              principalAmount: loan.principalAmount,
              interestRate: loan.interestRate,
              interestRateOverride: loan.interestRateOverride,
              penaltyMultiplier: loan.penaltyMultiplier,
              penaltyWaived: loan.penaltyWaived,
              penaltyWaivedAt: loan.penaltyWaivedAt,
              penaltyWaivedBy: loan.penaltyWaivedBy,
              minInterestDays: loan.minInterestDays,
              minPeriodOverride: loan.minPeriodOverride,
              rolledOverFrom: loan.rolledOverFrom,
              issuanceFee: loan.issuanceFee,
              loanType: loan.loanType,
              startDate: new Date(loan.startDate),
              createdAt: new Date(loan.createdAt),
            },
            payments: activePayments.map((payment) => {
              const portion = paymentPortions.get(payment.id);
              return {
                paymentDate: new Date(payment.paymentDate),
                amount: payment.amount,
                interestPortion: portion?.interestPortion ?? "0",
                principalPortion: portion?.principalPortion ?? "0",
                recorderName: "",
              };
            }),
            openingInterestSettled:
              rolloverInterestMap.get(loan.id)?.toFixed(2) ?? "0",
            waivers: activeWaivers.map((waiver) => {
              const portion = waiverPortions.get(waiver.id);
              return {
                waiverDate: new Date(waiver.waiverDate),
                amount: waiver.amount,
                interestPortion: portion?.interestPortion ?? "0",
                principalPortion: portion?.principalPortion ?? "0",
                reason: waiver.reason,
              };
            }),
            today: asOf,
          })
        : null;
    // Interest Earned includes non-cash accrual credits. Those are revenue,
    // not borrower payments, so a statement-backed balance must use only
    // actual payment/waiver allocations as interest settled.
    const totalInterestPaid = statement
      ? formatAmount([
          ...activePayments.map((payment) => paymentPortions.get(payment.id)?.interestPortion ?? "0"),
          ...activeWaivers.map((waiver) => waiverPortions.get(waiver.id)?.interestPortion ?? "0"),
        ].reduce((sum, portion) => sum.plus(portion), new BigNumber(0)))
      : legacyInterestPaid;
    const lastPaymentDate =
      settlementEvents.get(loan.id)?.date ?? new Date(loan.startDate);

    const computedInfo = computeLoanOverdueInfo({
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
      totalInterestAccrued: statement?.finalState.cumulativeInterestAccrued,
    });
    // The statement settles fractional portions before UGX rounding. Do not
    // re-round cumulative accrual and subtract the unrounded portions again:
    // that can overstate the amount due by one shilling.
    const info = statement
      ? {
          ...computedInfo,
          unpaidInterest: statement.finalState.netUnpaidInterest,
          daysOverdue: statement.finalState.daysOverdue,
          penaltyActive: statement.finalState.penaltyActive,
          effectiveRate: getEffectiveRate(loan, statement.finalState.penaltyActive),
        }
      : computedInfo;

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
