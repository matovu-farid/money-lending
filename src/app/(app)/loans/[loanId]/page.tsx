import { Effect } from "effect"
import { notFound } from "next/navigation"
import { getLoan } from "@/services/loan.service"
import { getPaymentsForLoan } from "@/services/payment.service"
import { db } from "@/lib/db"
import { customers } from "@/lib/db/schema/customers"
import { eq } from "drizzle-orm"
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

  return (
    <LoanDetailClient loan={loan} payments={payments} customerName={customerName} />
  )
}
