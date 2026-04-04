import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { eq } from "drizzle-orm"
import { RecordPaymentForm } from "./record-payment-form"

export default async function RecordPaymentPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = await params

  // Fetch loan + customer name for receipt display
  const result = await db
    .select({
      loanId: loans.id,
      customerId: loans.customerId,
      customerName: customers.fullName,
    })
    .from(loans)
    .innerJoin(customers, eq(loans.customerId, customers.id))
    .where(eq(loans.id, loanId))
    .limit(1)

  if (result.length === 0) {
    notFound()
  }

  const { customerName } = result[0]
  const loanReference = `LOAN-${loanId.slice(0, 8).toUpperCase()}`

  return (
    <RecordPaymentForm
      loanId={loanId}
      customerName={customerName}
      loanReference={loanReference}
    />
  )
}
