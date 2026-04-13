import { Effect } from "effect"
import { notFound } from "next/navigation"
import { getLoan } from "@/services/loan.service"
import { getPaymentsForLoan } from "@/services/payment.service"
import { getLoanBalanceFromLedger, getPaymentPortionsFromLedger, getInterestEarnedFromLedger } from "@/services/ledger-queries.service"
import { computeLoanOverdueInfo } from "@/lib/interest/overdue"
import { getBaseRate } from "@/lib/interest/effective-rate"
import BigNumber from "bignumber.js"
import { toLoanType, type PaymentPortionsMap, type UserRole } from "@/types"
import { db } from "@/lib/db"
import { customers } from "@/lib/db/schema/customers"
import { user } from "@/lib/db/schema/auth"
import { collateral } from "@/lib/db/schema/collateral"
import { eq, inArray } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { LoanDetailClient } from "./loan-detail-client"

export default async function LoanDetailPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = await params

  // Fetch loan (404 if not found)
  const loanResult = await Effect.runPromise(
    getLoan(loanId).pipe(Effect.either)
  )

  if (loanResult._tag === "Left") {
    notFound()
  }

  const loan = loanResult.right

  // Fetch payments (all, including soft-deleted for display)
  const paymentsResult = await Effect.runPromise(
    getPaymentsForLoan(loanId).pipe(Effect.either)
  )

  const payments = paymentsResult._tag === "Right" ? paymentsResult.right : []

  // Fetch payment portions from ledger
  let paymentPortions: PaymentPortionsMap = {}
  try {
    const activePaymentIds = payments.filter((p) => p.deletedAt === null).map((p) => p.id)
    if (activePaymentIds.length > 0) {
      const portionsMap = await getPaymentPortionsFromLedger(activePaymentIds)
      paymentPortions = Object.fromEntries(portionsMap)
    }
  } catch {
    // Non-critical — client will show 0.00 for portions
  }

  // Fetch ledger-derived outstanding balance
  let ledgerBalance: string | null = null
  try {
    const balance = await getLoanBalanceFromLedger(loanId)
    ledgerBalance = balance.toFixed(0)
  } catch {
    // Non-critical — client will fall back to payments-chain balance
  }

  // Compute daysOverdue for penalty derivation
  let daysOverdue = 0
  if (loan.status === "active") {
    try {
      const interestMap = await getInterestEarnedFromLedger([loan.id])
      const totalInterestPaid = interestMap.get(loan.id) ?? new BigNumber(0)
      const activePayments = payments.filter((p) => p.deletedAt === null && !p.markedWrong)
      const outstandingBalance = ledgerBalance ?? loan.principalAmount
      const baseRate = getBaseRate(loan)
      const info = computeLoanOverdueInfo({
        principalAmount: loan.principalAmount,
        baseRate,
        startDate: new Date(loan.startDate),
        loanType: toLoanType(loan.loanType),
        termMonths: loan.termMonths,
        totalInterestPaid: totalInterestPaid.toFixed(0),
        paymentCount: activePayments.length,
        outstandingBalance,
        penaltyWaived: loan.penaltyWaived,
        loan,
      })
      daysOverdue = info.daysOverdue
    } catch {
      // Non-critical — penalty badge won't show
    }
  }

  // Fetch customer name for display
  let customerName: string | null = null
  try {
    const [customer] = await db
      .select({ fullName: customers.fullName })
      .from(customers)
      .where(eq(customers.id, loan.customerId))
    customerName = customer?.fullName ?? null
  } catch {
    // Non-critical — page still renders without customer name
  }

  // Resolve recordedBy user IDs to names
  const userNameMap: Record<string, string> = {}
  const uniqueUserIds = [...new Set(payments.map((p) => p.recordedBy))]
  if (uniqueUserIds.length > 0) {
    try {
      const users = await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, uniqueUserIds))
      for (const u of users) {
        userNameMap[u.id] = u.name
      }
    } catch {
      // Non-critical — falls back to truncated ID
    }
  }

  // Fetch collateral for this loan
  const [loanCollateral] = await db
    .select()
    .from(collateral)
    .where(eq(collateral.loanId, loan.id))

  // Determine user role for role-gated UI (e.g. settle with collateral)
  const session = await auth.api.getSession({ headers: await headers() })
  const role = ((session?.user?.role ?? "unassigned") as UserRole)

  return (
    <LoanDetailClient
      loan={loan}
      initialPayments={payments}
      customerName={customerName}
      userNameMap={userNameMap}
      ledgerBalance={ledgerBalance}
      paymentPortions={paymentPortions}
      userRole={role}
      collateralNature={loanCollateral?.nature}
      collateralDescription={loanCollateral?.description}
      daysOverdue={daysOverdue}
    />
  )
}
