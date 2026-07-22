"use server";

import BigNumber from "bignumber.js";
import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "../db";
import { loans, payments } from "../db/schema";
import { computeSingleLoanBalanceData } from "./loanBalanceData";
import {
  allocatePayment,
  formatAmount,
  clampAllocationToUnpaidInterest,
} from "./engine";
import { getEffectiveRate } from "./effective-rate";
import { toLoanType } from "@/types";
import { getRemainingPrincipalFromLedger } from "@/services/ledger-queries.service";
import { daysBetween } from "@/lib/db/utils";
import { getLastSettlementDate } from "@/services/settlement.service";

type QueryDb = Pick<typeof db, "select">;

export type AllocateLoanSettlementParams = {
  amount: string;
  asOf: Date;
  loanId: string;
  /** Interest already collected from earlier settlements within the same min-interest period */
  interestAlreadyPaidInPeriod?: string;
  /** Override for edit/unmark when walking prior settlements */
  principalBalanceBefore?: string;
  paymentNumber?: number;
  prevSettlementDate?: Date;
  /** Use transaction handle so reads see in-flight journals (R14-C2) */
  queryDb?: QueryDb;
  /** Waivers are write-downs, not scheduled installments (R14-H1) */
  settlementKind?: "payment" | "waiver";
};

/**
 * Loan-type-aware settlement allocation shared by payments and waivers.
 * Dispatches to `allocatePayment` in engine.ts with balance context from
 * `computeSingleLoanBalanceData`.
 */
export async function allocateLoanSettlementAmount(
  params: AllocateLoanSettlementParams,
) {
  const {
    amount,
    asOf,
    loanId,
    interestAlreadyPaidInPeriod,
    principalBalanceBefore: principalOverride,
    paymentNumber: paymentNumberOverride,
    prevSettlementDate,
    queryDb = db,
    settlementKind = "payment",
  } = params;

  const [loan] = await queryDb
    .select()
    .from(loans)
    .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)));
  if (!loan) throw new Error(`Loan not found: ${loanId}`);

  const info = await computeSingleLoanBalanceData(loanId, asOf, queryDb);
  const monthlyRateDecimal = getEffectiveRate(loan, info.penaltyActive);
  const loanType = toLoanType(loan.loanType);
  const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays;

  let principalBalanceBefore = principalOverride;
  if (!principalBalanceBefore) {
    const map = await getRemainingPrincipalFromLedger([loanId], asOf, queryDb);
    principalBalanceBefore = formatAmount(map.get(loanId) ?? new BigNumber(0));
  }

  const prevDate =
    prevSettlementDate ??
    (await getLastSettlementDate(loan, { asOf }, queryDb));
  const daysElapsed = daysBetween(prevDate, asOf);

  let paymentNumber = paymentNumberOverride;
  if (!paymentNumber) {
    const activePayments = await queryDb
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.loanId, loanId),
          isNull(payments.deletedAt),
          eq(payments.markedWrong, false),
          lte(payments.paymentDate, asOf),
        ),
      );
    // Waivers do not advance the installment schedule on fixed_rate loans.
    paymentNumber =
      settlementKind === "waiver"
        ? Math.max(activePayments.length, 1)
        : activePayments.length + 1;
  }

  let allocation = allocatePayment({
    paymentAmount: amount,
    principalBalanceBefore,
    monthlyRateDecimal,
    daysElapsed,
    minInterestDays,
    loanType,
    originalPrincipal: loan.principalAmount,
    termMonths: loan.termMonths ?? undefined,
    paymentNumber,
    interestAlreadyPaidInPeriod,
  });

  allocation = clampAllocationToUnpaidInterest(
    allocation,
    amount,
    info.unpaidInterest,
    principalBalanceBefore,
    monthlyRateDecimal,
  );

  const principalAfter = new BigNumber(allocation.principalBalanceAfter);
  const unpaidAfter = BigNumber.max(
    new BigNumber(info.unpaidInterest).minus(allocation.interestPortion),
    0,
  );
  const loanFullyPaid = principalAfter.isZero() && unpaidAfter.isZero();

  return {
    ...allocation,
    loanFullyPaid,
    totalBalanceOwedAfter: formatAmount(principalAfter.plus(unpaidAfter)),
    ...info,
  };
}

export type AllocateLoanPaymentParams = Omit<
  AllocateLoanSettlementParams,
  "amount"
> & {
  paymentAmount: string;
};

export async function allocateLoanPaymentServerSide(
  params: AllocateLoanPaymentParams,
) {
  const { paymentAmount, ...rest } = params;
  return allocateLoanSettlementAmount({
    ...rest,
    amount: paymentAmount,
    settlementKind: "payment",
  });
}
