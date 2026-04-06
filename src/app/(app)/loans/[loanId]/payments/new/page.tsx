import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { eq } from "drizzle-orm"
import { getLoanBalanceSummary } from "@/services/payment.service"
import { RecordPaymentForm } from "./record-payment-form"

export default async function RecordPaymentPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = await params

  const [row] = await db
    .select({
      id: loans.id,
      principalAmount: loans.principalAmount,
      customerName: customers.fullName,
      loanType: loans.loanType,
      termMonths: loans.termMonths,
    })
    .from(loans)
    .innerJoin(customers, eq(loans.customerId, customers.id))
    .where(eq(loans.id, loanId))

  if (!row) notFound()

  const balanceData = await getLoanBalanceSummary(loanId)
  const loanReference = row.id.slice(0, 8).toUpperCase()

  return (
    <RecordPaymentForm
      loanId={loanId}
      customerName={row.customerName}
      loanReference={loanReference}
      balanceData={balanceData}
    />
  )
}
