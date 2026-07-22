// scripts/reconcile-loan-balances.ts
// One-off reconciliation: compares trigger-maintained loan_balances rows
// against a fresh server-side recompute via getLoanBalancesFromLedger /
// getInterestEarnedFromLedger. Reports any drift.
// Also checks rolled_over chain integrity (successor exists, ledger ≈ 0).
//
// Usage: pnpm tsx scripts/reconcile-loan-balances.ts
// Exit code 0 if all match; 1 if any drift.

import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import {
  getLoanBalancesFromLedger,
  getInterestEarnedFromLedger,
} from "@/services/ledger-queries.service";
import { eq, sql, and, isNull, isNotNull } from "drizzle-orm";
import BigNumber from "bignumber.js";
import { computeAllLoansBalanceData } from "@/lib/interest/loanBalanceData";

async function checkRolloverChainIntegrity(): Promise<number> {
  let issues = 0;
  const rolledOver = await db
    .select({ id: loans.id })
    .from(loans)
    .where(and(eq(loans.status, "rolled_over"), isNull(loans.deletedAt)));

  const ledgerBalances = await getLoanBalancesFromLedger(
    rolledOver.map((l) => l.id),
  );

  for (const { id } of rolledOver) {
    const successors = await db
      .select({ id: loans.id })
      .from(loans)
      .where(and(eq(loans.rolledOverFrom, id), isNull(loans.deletedAt)));

    if (successors.length === 0) {
      console.error(
        `[reconcile] CHAIN loan=${id}: rolled_over with no non-deleted successor`,
      );
      issues++;
    } else if (successors.length > 1) {
      console.error(
        `[reconcile] CHAIN loan=${id}: multiple successors (${successors.map((s) => s.id).join(", ")})`,
      );
      issues++;
    }

    const balance = ledgerBalances.get(id) ?? new BigNumber(0);
    if (!balance.isZero()) {
      console.error(
        `[reconcile] CHAIN loan=${id}: rolled_over ledger balance is ${balance.toFixed(2)} (expected ≈ 0)`,
      );
      issues++;
    }
  }

  // Reverse: every non-deleted loan with rolledOverFrom must point at a
  // predecessor that exists and is status=rolled_over (or soft-deleted).
  const withPredecessor = await db
    .select({
      id: loans.id,
      rolledOverFrom: loans.rolledOverFrom,
    })
    .from(loans)
    .where(and(isNotNull(loans.rolledOverFrom), isNull(loans.deletedAt)));

  for (const row of withPredecessor) {
    const predId = row.rolledOverFrom!;
    const [pred] = await db
      .select({ id: loans.id, status: loans.status, deletedAt: loans.deletedAt })
      .from(loans)
      .where(eq(loans.id, predId))
      .limit(1);

    if (!pred) {
      console.error(
        `[reconcile] CHAIN loan=${row.id}: rolledOverFrom=${predId} predecessor missing`,
      );
      issues++;
    } else if (pred.status !== "rolled_over" && !pred.deletedAt) {
      console.error(
        `[reconcile] CHAIN loan=${row.id}: rolledOverFrom=${predId} has status=${pred.status} (expected rolled_over)`,
      );
      issues++;
    }
  }

  return issues;
}

async function main() {
  const allLoans = await db.select({ id: loans.id }).from(loans);
  const ids = allLoans.map((l) => l.id);
  if (ids.length === 0) {
    console.log("[reconcile] no loans found; nothing to check");
    return;
  }

  const [serverBalances, serverInterest, projectionRows] = await Promise.all([
    getLoanBalancesFromLedger(ids),
    getInterestEarnedFromLedger(ids),
    computeAllLoansBalanceData(),
  ]);

  // Server-side last_payment_date per loan (one query for all loans).
  const lpdRows = await db
    .select({
      loanId: payments.loanId,
      lpd: sql<Date>`MAX(${payments.paymentDate})`,
    })
    .from(payments)
    .groupBy(payments.loanId);
  const serverLpd = new Map(lpdRows.map((r) => [r.loanId, r.lpd]));

  const projection = new Map(projectionRows.map((r) => [r.loanId, r]));

  let drift = 0;
  for (const id of ids) {
    const expectedBalance = serverBalances.get(id) ?? new BigNumber(0);
    const expectedInterest = serverInterest.get(id) ?? new BigNumber(0);
    const expectedLpd = serverLpd.get(id) ?? null;
    const proj = projection.get(id);
    if (!proj) {
      console.error(
        `[reconcile] DRIFT loan=${id}: projection row missing entirely`,
      );
      drift++;
      continue;
    }
    const actualBalance = new BigNumber(proj.totalBalanceOwed);
    const actualInterest = new BigNumber(proj.unpaidInterest);
    // Path A zeros non-operational display balances — only flag drift when
    // the projection still shows a non-zero balance that disagrees with ledger.
    if (!actualBalance.isEqualTo(expectedBalance) && !actualBalance.isZero()) {
      console.error(
        `[reconcile] DRIFT loan=${id} outstanding_balance: projection=${actualBalance.toFixed(2)} expected=${expectedBalance.toFixed(2)}`,
      );
      drift++;
    }
    if (
      !actualInterest.isEqualTo(expectedInterest) &&
      !actualInterest.isZero()
    ) {
      console.error(
        `[reconcile] DRIFT loan=${id} unpaid_interest: projection=${actualInterest.toFixed(2)} expected=${expectedInterest.toFixed(2)}`,
      );
      drift++;
    }
    const projLpdMs = proj.lastPaymentDate?.getTime() ?? null;
    const expLpdMs = expectedLpd?.getTime() ?? null;
    if (projLpdMs !== expLpdMs && !actualBalance.isZero()) {
      console.error(
        `[reconcile] DRIFT loan=${id} last_payment_date: projection=${proj.lastPaymentDate} expected=${expectedLpd}`,
      );
      drift++;
    }
  }

  const chainIssues = await checkRolloverChainIntegrity();
  drift += chainIssues;

  if (drift === 0) {
    console.log(`[reconcile] OK — ${ids.length} loan(s) checked, no drift`);
  } else {
    console.error(
      `[reconcile] FAIL — ${drift} drift event(s) across ${ids.length} loan(s)`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[reconcile] crashed:", err);
  process.exit(1);
});
