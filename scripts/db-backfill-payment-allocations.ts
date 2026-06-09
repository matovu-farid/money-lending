// scripts/db-backfill-payment-allocations.ts
//
// Backfills payment allocations under the corrected min-interest-period rule:
// the 30-day minimum is enforced ONLY on the first payment of a perpetual
// loan; subsequent payments accrue interest pro-rata over actual days since
// the previous payment. Older payments were charged a full month each, which
// over-allocated interest and under-allocated principal on every subsequent
// payment.
//
// What this script does:
//   1. Iterates every active perpetual loan.
//   2. Walks each loan's payments in chronological order, recomputing the
//      correct allocation via the engine's allocatePayment().
//   3. Compares to the actual allocation stored in the ledger.
//   4. For each payment whose interest portion was over-charged, posts a
//      balanced "payment_reversal" journal entry pair:
//         - Debit  Interest Earned    (reduces recognised revenue)
//         - Credit Loans Receivable   (further reduces the loan asset)
//      The reversal shares reference_id with the original payment so
//      getPaymentPortionsFromLedger() nets the two automatically.
//
// USAGE
//   DATABASE_URL=... pnpm tsx scripts/db-backfill-payment-allocations.ts          # dry run
//   DATABASE_URL=... pnpm tsx scripts/db-backfill-payment-allocations.ts --apply  # post
//
// The dry run is always safe — it only reads. --apply wraps every loan's
// adjustments in a single transaction so a partial failure rolls back cleanly.

import BigNumber from "bignumber.js"
import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "../src/lib/db"
import { loans } from "../src/lib/db/schema/loans"
import { payments } from "../src/lib/db/schema/payments"
import { user } from "../src/lib/db/schema/auth"
import { allocatePayment } from "../src/lib/interest/engine"
import { getPaymentPortionsFromLedger } from "../src/services/ledger-queries.service"
import { postJournalEntry } from "../src/services/transaction.service"
import { daysBetween } from "../src/lib/db/utils"

const APPLY = process.argv.includes("--apply")

interface PaymentDelta {
  paymentId: string
  paymentDate: Date
  paymentNumber: number
  amount: string
  daysElapsed: number
  oldInterest: string
  newInterest: string
  oldPrincipal: string
  newPrincipal: string
  overChargedInterest: string
}

interface LoanReport {
  loanId: string
  customerId: string
  principalAmount: string
  paymentCount: number
  deltas: PaymentDelta[]
  totalOverCharged: string
}

async function main() {
  console.log(
    `[backfill] mode: ${APPLY ? "APPLY (will write to DB)" : "DRY RUN (read only)"}`,
  )

  // Resolve a system user id for recordedBy. Required by the transactions table.
  const [sysUser] = await db.select().from(user).limit(1)
  if (!sysUser) {
    console.error("[backfill] no users found in DB; cannot post adjustments")
    process.exit(1)
  }
  const recordedBy = sysUser.id
  if (APPLY) {
    console.log(`[backfill] adjustments will be recorded by user ${sysUser.email} (${recordedBy})`)
  }

  // Pull every active perpetual loan with 2+ payments (single-payment loans
  // cannot have a "subsequent" payment to mis-allocate).
  const allLoans = await db
    .select()
    .from(loans)
    .where(and(isNull(loans.deletedAt), eq(loans.loanType, "perpetual")))
    .orderBy(asc(loans.createdAt))

  console.log(`[backfill] scanning ${allLoans.length} perpetual loans`)

  const reports: LoanReport[] = []

  for (const loan of allLoans) {
    const loanPayments = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.loanId, loan.id),
          isNull(payments.deletedAt),
          eq(payments.markedWrong, false),
        ),
      )
      .orderBy(asc(payments.paymentDate))

    if (loanPayments.length < 2) continue

    const monthlyRate = loan.interestRateOverride ?? loan.interestRate
    const minInterestDays = loan.minPeriodOverride ?? loan.minInterestDays

    const portionsMap = await getPaymentPortionsFromLedger(
      loanPayments.map((p) => p.id),
    )

    let runningBalance = new BigNumber(loan.principalAmount)
    let prevDate: Date = loan.startDate
    const deltas: PaymentDelta[] = []

    for (let i = 0; i < loanPayments.length; i++) {
      const p = loanPayments[i]
      const paymentNumber = i + 1
      const daysElapsed = daysBetween(prevDate, p.paymentDate)

      const corrected = allocatePayment({
        paymentAmount: p.amount,
        principalBalanceBefore: runningBalance.toFixed(2),
        monthlyRateDecimal: monthlyRate,
        daysElapsed,
        minInterestDays,
        loanType: "perpetual",
        paymentNumber,
      })

      const original = portionsMap.get(p.id) ?? {
        interestPortion: "0",
        principalPortion: "0",
      }
      const oldInterest = new BigNumber(original.interestPortion)
      const newInterest = new BigNumber(corrected.interestPortion)
      const oldPrincipal = new BigNumber(original.principalPortion)
      const newPrincipal = new BigNumber(corrected.principalPortion)
      const overCharged = oldInterest.minus(newInterest)

      // Only record materially over-charged payments (> 1 UGX, to ignore
      // BigNumber rounding noise).
      if (overCharged.isGreaterThan(1)) {
        deltas.push({
          paymentId: p.id,
          paymentDate: p.paymentDate,
          paymentNumber,
          amount: p.amount,
          daysElapsed,
          oldInterest: oldInterest.toFixed(2),
          newInterest: newInterest.toFixed(2),
          oldPrincipal: oldPrincipal.toFixed(2),
          newPrincipal: newPrincipal.toFixed(2),
          overChargedInterest: overCharged.toFixed(2),
        })
      }

      // Walk the running balance forward using the CORRECTED principal so
      // the next payment's daysElapsed-based interest lines up with what
      // the borrower really owed at that moment.
      runningBalance = BigNumber.max(runningBalance.minus(newPrincipal), 0)
      prevDate = p.paymentDate
    }

    if (deltas.length === 0) continue

    const totalOverCharged = deltas.reduce(
      (sum, d) => sum.plus(new BigNumber(d.overChargedInterest)),
      new BigNumber(0),
    )

    reports.push({
      loanId: loan.id,
      customerId: loan.customerId,
      principalAmount: loan.principalAmount,
      paymentCount: loanPayments.length,
      deltas,
      totalOverCharged: totalOverCharged.toFixed(2),
    })
  }

  // ── Summary ────────────────────────────────────────────────────────────

  const grandTotal = reports.reduce(
    (sum, r) => sum.plus(new BigNumber(r.totalOverCharged)),
    new BigNumber(0),
  )
  const affectedPayments = reports.reduce((sum, r) => sum + r.deltas.length, 0)

  console.log()
  console.log("=".repeat(80))
  console.log(`affected loans:    ${reports.length}`)
  console.log(`affected payments: ${affectedPayments}`)
  console.log(`total over-charged interest: UGX ${grandTotal.toFixed(2)}`)
  console.log("=".repeat(80))
  console.log()

  for (const r of reports) {
    console.log(`loan ${r.loanId} — principal ${r.principalAmount}, ${r.paymentCount} payments, over-charged UGX ${r.totalOverCharged}`)
    for (const d of r.deltas) {
      console.log(
        `  payment #${d.paymentNumber} (${d.paymentDate.toISOString().slice(0, 10)}, ${d.daysElapsed}d): interest ${d.oldInterest} → ${d.newInterest}, principal ${d.oldPrincipal} → ${d.newPrincipal}, over-charge ${d.overChargedInterest}`,
      )
    }
  }

  if (!APPLY) {
    console.log()
    console.log("[backfill] dry run complete — no changes posted. Re-run with --apply to commit.")
    process.exit(0)
  }

  // ── Apply ──────────────────────────────────────────────────────────────

  console.log()
  console.log("[backfill] posting adjustments…")
  const now = new Date()

  for (const r of reports) {
    await db.transaction(async (tx) => {
      for (const d of r.deltas) {
        await postJournalEntry(tx, {
          // Reducing recognised interest revenue → DEBIT Interest Earned.
          debitCategory: { name: "Interest Earned", type: "revenue" },
          // Reducing the loan asset (additional principal repaid) → CREDIT Loans Receivable.
          creditCategory: { name: "Loans Receivable", type: "asset" },
          amount: d.overChargedInterest,
          referenceType: "payment_reversal",
          referenceId: d.paymentId,
          loanId: r.loanId,
          description: `Backfill: corrected first-payment-only min-interest rule (payment ${d.paymentId})`,
          transactionDate: now,
          recordedBy,
        })
      }
    })
    console.log(`  loan ${r.loanId}: posted ${r.deltas.length} adjustments`)
  }

  console.log()
  console.log(`[backfill] applied — ${affectedPayments} adjustments across ${reports.length} loans, total UGX ${grandTotal.toFixed(2)}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] failed:", err)
    process.exit(1)
  })
