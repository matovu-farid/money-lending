import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { loanWaivers } from "@/lib/db/schema/loan-waivers";
import { transactions } from "@/lib/db/schema/transactions";
import { transactionCategories } from "@/lib/db/schema/transaction-categories";
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
import { postJournalEntry, reverseInterestAccrual } from "./transaction.service";
import { formatAmount } from "@/lib/interest/engine";
import { getWaiverPortionsFromLedger } from "./ledger-queries.service";
import { shortId } from "@/lib/utils";
import type {
  LoanWaiverWithPortions,
  WaiveLoanAmountInput,
  LoanWaiver,
  UndoLoanWaiverInput,
  UndoLoanWaiverResult,
} from "@/types";

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
        reversalReferenceType: "loan_waiver_accrual_reversal",
        reversalReferenceId: waiver.id,
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

async function getWaiverAccrualReversalAmount(
  tx: Pick<typeof db, "select">,
  waiverId: string,
): Promise<string | null> {
  const rows = await tx
    .select({
      categoryName: transactionCategories.name,
      type: transactions.type,
      amount: transactions.amount,
    })
    .from(transactions)
    .innerJoin(
      transactionCategories,
      eq(transactions.categoryId, transactionCategories.id),
    )
    .where(
      and(
        eq(
          transactions.referenceType,
          "loan_waiver_accrual_reversal",
        ),
        eq(transactions.referenceId, waiverId),
      ),
    );

  if (rows.length === 0) return null;

  let receivableCredit = new BigNumber(0);
  let earnedDebit = new BigNumber(0);
  for (const row of rows) {
    if (row.categoryName === "Interest Receivable" && row.type === "credit") {
      receivableCredit = receivableCredit.plus(row.amount);
    } else if (row.categoryName === "Interest Earned" && row.type === "debit") {
      earnedDebit = earnedDebit.plus(row.amount);
    } else {
      throw {
        _tag: "ValidationError",
        message: "Waiver accrual reversal entries are invalid",
        field: "waiverId",
      };
    }
  }

  if (receivableCredit.isZero() || !receivableCredit.eq(earnedDebit)) {
    throw {
      _tag: "ValidationError",
      message: "Waiver accrual reversal entries are invalid",
      field: "waiverId",
    };
  }

  return receivableCredit.toFixed(2);
}

export async function undoLoanWaiver(
  input: UndoLoanWaiverInput,
  actorId: string,
): Promise<UndoLoanWaiverResult> {
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw {
      _tag: "ValidationError",
      message: "Reason must be at least 10 characters",
      field: "reason",
    };
  }

  return db.transaction(async (tx) => {
    const [waiver] = await tx
      .select()
      .from(loanWaivers)
      .where(
        and(
          eq(loanWaivers.id, input.waiverId),
          isNull(loanWaivers.deletedAt),
        ),
      )
      .for("update");

    if (!waiver) {
      throw { _tag: "WaiverNotFound", id: input.waiverId };
    }

    const [loan] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.id, waiver.loanId), isNull(loans.deletedAt)))
      .for("update");

    if (!loan) {
      throw { _tag: "LoanNotFound", id: waiver.loanId };
    }

    if (loan.status !== "active" && loan.status !== "fully_paid") {
      throw {
        _tag: "ValidationError",
        message:
          "Loan waiver can only be undone on active or fully paid loans",
        field: "status",
      };
    }

    const portion = (await getWaiverPortionsFromLedger([waiver.id], tx)).get(
      waiver.id,
    );
    if (!portion) {
      throw {
        _tag: "ValidationError",
        message: "Waiver ledger entries could not be found",
        field: "waiverId",
      };
    }

    const interestPortion = portion.interestPortion;
    const principalPortion = portion.principalPortion;
    if (
      new BigNumber(interestPortion).isZero() &&
      new BigNumber(principalPortion).isZero()
    ) {
      throw {
        _tag: "ValidationError",
        message: "Waiver ledger entries could not be found",
        field: "waiverId",
      };
    }

    const reversalDate = new Date();
    const loanRef = shortId(loan.id).toUpperCase();
    const accrualReversalAmount = await getWaiverAccrualReversalAmount(
      tx,
      waiver.id,
    );

    if (accrualReversalAmount) {
      await postJournalEntry(tx, {
        debitCategory: { name: "Interest Receivable", type: "revenue" },
        creditCategory: { name: "Interest Earned", type: "revenue" },
        amount: accrualReversalAmount,
        referenceType: "loan_waiver_reversal",
        referenceId: waiver.id,
        description: `Reversal - accrued interest correction for loan ${loanRef}: ${reason}`,
        transactionDate: reversalDate,
        recordedBy: actorId,
      });
    }

    if (new BigNumber(interestPortion).isGreaterThan(0)) {
      await postJournalEntry(tx, {
        debitCategory: { name: "Interest Earned", type: "revenue" },
        creditCategory: { name: "Loan Losses", type: "expense" },
        amount: interestPortion,
        referenceType: "loan_waiver_reversal",
        referenceId: waiver.id,
        description: `Reversal - interest waiver for loan ${loanRef}: ${reason}`,
        transactionDate: reversalDate,
        recordedBy: actorId,
        loanId: loan.id,
      });
    }

    if (new BigNumber(principalPortion).isGreaterThan(0)) {
      await postJournalEntry(tx, {
        debitCategory: { name: "Loans Receivable", type: "asset" },
        creditCategory: { name: "Loan Losses", type: "expense" },
        amount: principalPortion,
        referenceType: "loan_waiver_reversal",
        referenceId: waiver.id,
        description: `Reversal - principal waiver for loan ${loanRef}: ${reason}`,
        transactionDate: reversalDate,
        recordedBy: actorId,
        loanId: loan.id,
      });
    }

    await tx
      .update(loanWaivers)
      .set({ deletedAt: reversalDate })
      .where(
        and(eq(loanWaivers.id, waiver.id), isNull(loanWaivers.deletedAt)),
      );

    if (
      loan.status === "fully_paid" &&
      !(await isLoanEconomicallyFullyPaid(loan.id, reversalDate, tx, {
        forceOperational: true,
      }))
    ) {
      await maybeUpdateLoanStatusAfterPayment(tx, loan, "active", actorId);
    }

    const [updatedLoan] = await tx
      .select({ status: loans.status })
      .from(loans)
      .where(eq(loans.id, loan.id));
    const nextStatus = updatedLoan?.status ?? loan.status;

    await writeAuditLog(tx, {
      actorId,
      action: "loan.waiver.undo",
      entityType: "loan",
      entityId: loan.id,
      beforeValue: {
        waiverId: waiver.id,
        amount: waiver.amount,
        interestPortion,
        principalPortion,
        status: loan.status,
      },
      afterValue: {
        reason,
        status: nextStatus,
      },
    });

    const txidRows = await tx.execute<{ txid: string }>(
      sql`SELECT pg_current_xact_id()::text as txid`,
    );
    const txid = Number(
      (txidRows as unknown as Array<{ txid: string }>)[0].txid,
    );

    return {
      loanId: loan.id,
      waiverId: waiver.id,
      reversedAmount: formatAmount(
        new BigNumber(interestPortion).plus(principalPortion),
      ),
      interestPortion,
      principalPortion,
      previousStatus: loan.status,
      status: nextStatus,
      txid,
    };
  });
}

export async function listLoanWaiversForLoan(
  loanId: string,
  queryDb: Pick<typeof db, "select"> = db,
): Promise<LoanWaiverWithPortions[]> {
  const rows = await queryDb
    .select()
    .from(loanWaivers)
    .where(and(eq(loanWaivers.loanId, loanId), isNull(loanWaivers.deletedAt)))
    .orderBy(asc(loanWaivers.waiverDate));

  const portions = await getWaiverPortionsFromLedger(
    rows.map((row) => row.id),
    queryDb,
  );
  return rows.map((row): LoanWaiverWithPortions => {
    const portion = portions.get(row.id);
    return {
      ...row,
      interestPortion: portion?.interestPortion ?? "0",
      principalPortion: portion?.principalPortion ?? "0",
    };
  });
}
