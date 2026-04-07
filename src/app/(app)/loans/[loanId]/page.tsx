import { Effect } from "effect"
import { notFound } from "next/navigation"
import { getLoan } from "@/services/loan.service"
import { getPaymentsForLoan } from "@/services/payment.service"
import { getLoanBalanceFromLedger, getPaymentPortionsFromLedger } from "@/services/transaction.service"
import { db } from "@/lib/db"
import { customers } from "@/lib/db/schema/customers"
import { user } from "@/lib/db/schema/auth"
import { collateral } from "@/lib/db/schema/collateral"
import { eq, inArray } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { ROLE_LEVELS, type UserRole } from "@/types"
import { LoanDetailClient } from "./loan-detail-client"

export default async function LoanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ loanId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { loanId } = await params
  const sp = await searchParams

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
  let paymentPortions: Record<string, { interestPortion: string; principalPortion: string }> = {}
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
    ledgerBalance = balance.toFixed(2)
  } catch {
    // Non-critical — client will fall back to payments-chain balance
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

  // Determine canModify based on role
  const session = await auth.api.getSession({ headers: await headers() })
  const role = ((session?.user?.role ?? "unassigned") as UserRole)
  const userId = session?.user?.id ?? ""

  let canModify = false
  if (ROLE_LEVELS[role] >= ROLE_LEVELS.admin) {
    // Admin+ can always edit/delete any loan
    canModify = true
  } else if (role === "loanOfficer" || role === "supervisor") {
    // Loan officers and supervisors can only edit/delete a loan they just created (freshly created = ?new=1 param)
    // and only their own loan — once they navigate away or reload, the privilege is gone
    const freshlyCreated = sp.new === "1"
    if (freshlyCreated && loan.issuedBy === userId) {
      canModify = true
    }
  }

  const openEdit = sp.edit === "1" && canModify

  return (
    <LoanDetailClient
      loan={loan}
      initialPayments={payments}
      customerName={customerName}
      canModify={canModify}
      openEditOnMount={openEdit}
      userNameMap={userNameMap}
      ledgerBalance={ledgerBalance}
      paymentPortions={paymentPortions}
      userRole={role}
      collateralNature={loanCollateral?.nature}
      collateralDescription={loanCollateral?.description}
    />
  )
}
