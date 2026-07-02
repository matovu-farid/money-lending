import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema/loans";
import { payments } from "@/lib/db/schema/payments";
import { eq, and, isNull, asc, inArray } from "drizzle-orm";
import {
  getLoanBalancesFromLedger,
  getInterestEarnedFromLedger,
} from "@/services/ledger-queries.service";
import { captureServerError } from "@/lib/sentry";
import { computeSingleLoanBalanceData } from "@/lib/interest/loanBalanceData";
/**
 * Determine whether a loan's penalty waiver should be reset.
 * The waiver should only be reset when the borrower is fully current
 * (0 days overdue), not merely below the 60-day penalty threshold.
 */
export function shouldResetPenaltyWaiver(
  daysOverdue: number,
  penaltyWaived: boolean,
): boolean {
  return daysOverdue === 0 && penaltyWaived;
}

export async function GET(request: NextRequest) {
  // Fail-closed: reject if CRON_SECRET is not configured
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const activeLoans = await db
      .select()
      .from(loans)
      .where(and(eq(loans.status, "active"), isNull(loans.deletedAt)));

    const now = new Date();
    const results: { loanId: string; daysOverdue: string }[] = [];

    const loanIds = activeLoans.map((l) => l.id);

    const ledgerBalances = await getLoanBalancesFromLedger(loanIds);
    const interestEarnedMap = await getInterestEarnedFromLedger(loanIds);

    const allPayments =
      loanIds.length > 0
        ? await db
            .select()
            .from(payments)
            .where(
              and(
                inArray(payments.loanId, loanIds),
                isNull(payments.deletedAt),
                eq(payments.markedWrong, false),
              ),
            )
            .orderBy(asc(payments.paymentDate))
        : [];

    const paymentsByLoan = new Map<string, (typeof allPayments)[number][]>();
    for (const p of allPayments) {
      const list = paymentsByLoan.get(p.loanId) ?? [];
      list.push(p);
      paymentsByLoan.set(p.loanId, list);
    }

    for (const loan of activeLoans) {
      try {
        const info = await computeSingleLoanBalanceData(loan.id, new Date());

        if (info.daysOverdue >= 30) {
          results.push({
            loanId: loan.id,
            daysOverdue: String(info.daysOverdue),
          });
        }

        // Reset waiver only when borrower is fully current (0 days overdue).
        // This ensures the admin-approved waiver stays in place while the
        // borrower is still behind, and only resets for future overdue episodes.
        if (shouldResetPenaltyWaiver(info.daysOverdue, loan.penaltyWaived)) {
          await db
            .update(loans)
            .set({
              penaltyWaived: false,
              penaltyWaivedBy: null,
              penaltyWaivedAt: null,
            })
            .where(eq(loans.id, loan.id));
          console.log(
            `[overdue-cron] Penalty waiver reset for loan ${loan.id} (back to good standing)`,
          );
        }
      } catch (err) {
        console.error(`[Cron] Failed to process loan ${loan.id}:`, err);
        captureServerError(err, { source: "cron:overdue", loanId: loan.id });
      }
    }

    return Response.json({
      processed: activeLoans.length,
      flagged: results.length,
      flaggedLoans: results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("[Cron] Overdue detection failed:", error);
    captureServerError(error, { source: "cron:overdue", phase: "outer" });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
