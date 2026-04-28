// scripts/reconcile-loan-balances.ts
// One-off reconciliation: compares trigger-maintained loan_balances rows
// against a fresh server-side recompute via getLoanBalancesFromLedger /
// getInterestEarnedFromLedger. Reports any drift.
//
// Usage: pnpm tsx scripts/reconcile-loan-balances.ts
// Exit code 0 if all match; 1 if any drift.

import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { loanBalances } from "@/lib/db/schema/loan-balances"
import { payments } from "@/lib/db/schema/payments"
import {
  getLoanBalancesFromLedger,
  getInterestEarnedFromLedger,
} from "@/services/ledger-queries.service"
import { eq, sql } from "drizzle-orm"
import BigNumber from "bignumber.js"

async function main() {
  const allLoans = await db.select({ id: loans.id }).from(loans)
  const ids = allLoans.map((l) => l.id)
  if (ids.length === 0) {
    console.log("[reconcile] no loans found; nothing to check")
    return
  }

  const [serverBalances, serverInterest, projectionRows] = await Promise.all([
    getLoanBalancesFromLedger(ids),
    getInterestEarnedFromLedger(ids),
    db.select().from(loanBalances),
  ])

  // Server-side last_payment_date per loan (one query for all loans).
  const lpdRows = await db
    .select({ loanId: payments.loanId, lpd: sql<Date>`MAX(${payments.paymentDate})` })
    .from(payments)
    .groupBy(payments.loanId)
  const serverLpd = new Map(lpdRows.map((r) => [r.loanId, r.lpd]))

  const projection = new Map(projectionRows.map((r) => [r.loanId, r]))

  let drift = 0
  for (const id of ids) {
    const expectedBalance = serverBalances.get(id) ?? new BigNumber(0)
    const expectedInterest = serverInterest.get(id) ?? new BigNumber(0)
    const expectedLpd = serverLpd.get(id) ?? null
    const proj = projection.get(id)
    if (!proj) {
      console.error(`[reconcile] DRIFT loan=${id}: projection row missing entirely`)
      drift++
      continue
    }
    const actualBalance = new BigNumber(proj.outstandingBalance)
    const actualInterest = new BigNumber(proj.unpaidInterest)
    if (!actualBalance.isEqualTo(expectedBalance)) {
      console.error(
        `[reconcile] DRIFT loan=${id} outstanding_balance: projection=${actualBalance.toFixed(2)} expected=${expectedBalance.toFixed(2)}`,
      )
      drift++
    }
    if (!actualInterest.isEqualTo(expectedInterest)) {
      console.error(
        `[reconcile] DRIFT loan=${id} unpaid_interest: projection=${actualInterest.toFixed(2)} expected=${expectedInterest.toFixed(2)}`,
      )
      drift++
    }
    const projLpdMs = proj.lastPaymentDate?.getTime() ?? null
    const expLpdMs = expectedLpd?.getTime() ?? null
    if (projLpdMs !== expLpdMs) {
      console.error(
        `[reconcile] DRIFT loan=${id} last_payment_date: projection=${proj.lastPaymentDate} expected=${expectedLpd}`,
      )
      drift++
    }
  }

  if (drift === 0) {
    console.log(`[reconcile] OK — ${ids.length} loan(s) checked, no drift`)
  } else {
    console.error(`[reconcile] FAIL — ${drift} drift event(s) across ${ids.length} loan(s)`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("[reconcile] crashed:", err)
  process.exit(1)
})
