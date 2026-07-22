import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { eq, and, isNull, sql, asc } from "drizzle-orm";
import BigNumber from "bignumber.js";
import { endOfDay } from "date-fns";
import { assertLoanOperational } from "@/lib/loan-visibility";
import { writeAuditLog } from "./audit.service";
import { allocateLoanSettlementAmount } from "@/lib/interest/engine-server";
import {
  autoPostLoanWaiverInterest,
  autoPostLoanWaiverPrincipal,
} from "./auto-post.service";
import { getLoanBalanceFromLedger } from "./ledger-queries.service";
import {
  isLoanEconomicallyFullyPaid,
  maybeUpdateLoanStatusAfterPayment,
} from "./payment.service";
import { reverseInterestAccrual } from "./transaction.service";
import { formatAmount } from "@/lib/interest/engine";
import type { WaiveLoanAmountInput, LoanWaiver } from "@/types";

export async function waiveLoanAmount(
  input: WaiveLoanAmountInput,
  actorId: string,
): Promise<{
  waiver: LoanWaiver;
  interestPortion: string;
  principalPortion: string;
  txid: number;
}> {
  return db.transaction(async (tx) => {
    const [loan] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.id, input.loanId), isNull(loans.deletedAt)))
      .for("update");

    if (!loan || loan.deletedAt) {
      throw { _tag: "LoanNotFound", id: input.loanId };
    }

    assertLoanOperational(loan);

    const waiverDate = new Date();
    const asOf = endOfDay(waiverDate);

    const allocation = await allocateLoanSettlementAmount({
      amount: input.amount,
      asOf,
      loanId: input.loanId,
      queryDb: tx,
      settlementKind: "waiver",
    });

    const totalOwedBefore = new BigNumber(
      allocation.remainingPrincipalAmount,
    ).plus(allocation.unpaidInterest);

    if (new BigNumber(input.amount).isGreaterThan(totalOwedBefore)) {
      throw {
        _tag: "ValidationError",
        message: `Waiver amount ${input.amount} exceeds total owed ${formatAmount(totalOwedBefore)}`,
        field: "amount",
      };
    }

    const principalBefore = await getLoanBalanceFromLedger(
      loan.id,
      undefined,
      tx,
    );

    const [waiver] = await tx
      .insert(loanWaivers)
      .values({
        ...(input.id ? { id: input.id } : {}),
        loanId: input.loanId,
        amount: input.amount,
        waiverDate,
        reason: input.reason.trim(),
        recordedBy: actorId,
      })
      .returning();

    const interestPortion = allocation.interestPortion;
    const principalPortion = allocation.principalPortion;

    if (new BigNumber(interestPortion).isGreaterThan(0)) {
      await reverseInterestAccrual(tx, {
        loanId: input.loanId,
        paymentDate: waiverDate.toISOString(),
        actorId,
      });
      await autoPostLoanWaiverInterest(tx, {
        amount: interestPortion,
        loanId: input.loanId,
        waiverId: waiver.id,
        waiverDate: waiverDate.toISOString(),
        actorId,
      });
    }

    if (new BigNumber(principalPortion).isGreaterThan(0)) {
      await autoPostLoanWaiverPrincipal(tx, {
        amount: principalPortion,
        loanId: input.loanId,
        waiverId: waiver.id,
        waiverDate: waiverDate.toISOString(),
        actorId,
      });
    }

    if (await isLoanEconomicallyFullyPaid(input.loanId, waiverDate, tx)) {
      await maybeUpdateLoanStatusAfterPayment(
        tx,
        loan,
        "fully_paid",
        actorId,
      );
    }

    const [updatedLoan] = await tx
      .select()
      .from(loans)
      .where(eq(loans.id, loan.id));

    await writeAuditLog(tx, {
      actorId,
      action: "loan.waiver",
      entityType: "loan",
      entityId: loan.id,
      beforeValue: {
        outstandingPrincipal: principalBefore.toFixed(0),
        status: loan.status,
      },
      afterValue: {
        waiverId: waiver.id,
        amount: input.amount,
        interestPortion,
        principalPortion,
        reason: input.reason.trim(),
        status: updatedLoan?.status ?? loan.status,
      },
    });

    const txidRows = await tx.execute<{ txid: string }>(
      sql`SELECT pg_current_xact_id()::text as txid`,
    );
    const txid = Number(
      (txidRows as unknown as Array<{ txid: string }>)[0].txid,
    );

    return { waiver, interestPortion, principalPortion, txid };
  });
}

export async function listLoanWaiversForLoan(
  loanId: string,
  queryDb: Pick<typeof db, "select"> = db,
): Promise<LoanWaiver[]> {
  return queryDb
    .select()
    .from(loanWaivers)
    .where(and(eq(loanWaivers.loanId, loanId), isNull(loanWaivers.deletedAt)))
    .orderBy(asc(loanWaivers.waiverDate));
}
