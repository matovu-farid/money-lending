import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { user } from "@/lib/db/schema/auth"
import { eq } from "drizzle-orm"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { PrintButton } from "@/app/(app)/receipts/disbursement/[loanId]/print-button"
import { formatDate } from "@/lib/utils"

export default async function RepaymentReceiptPage({
  params,
}: {
  params: Promise<{ paymentId: string }>
}) {
  const { paymentId } = await params

  // Fetch payment record
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))

  if (!payment) {
    return (
      <div className="container max-w-2xl mx-auto p-4 md:p-6">
        <Alert variant="destructive">
          <AlertTitle>Payment not found</AlertTitle>
          <AlertDescription>
            No payment record was found for the provided ID.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (payment.deletedAt) {
    return (
      <div className="container max-w-2xl mx-auto p-4 md:p-6">
        <Alert variant="destructive">
          <AlertTitle>Cannot print receipt</AlertTitle>
          <AlertDescription>
            This payment has been deleted and its receipt is no longer
            available.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // Fetch loan and customer in parallel
  const [[loan], [recordingUser]] = await Promise.all([
    db.select().from(loans).where(eq(loans.id, payment.loanId)),
    db.select().from(user).where(eq(user.id, payment.recordedBy)),
  ])

  const [customer] = loan
    ? await db.select().from(customers).where(eq(customers.id, loan.customerId))
    : []

  // RCPT-03 completeness check
  const missingFields: string[] = []
  if (!customer?.fullName) missingFields.push("Customer name")
  if (!payment?.amount) missingFields.push("Payment amount")
  if (!payment?.interestPortion) missingFields.push("Interest allocation")
  if (!loan?.id) missingFields.push("Loan reference")

  const isBlocked = missingFields.length > 0

  // Format helpers
  const formatCurrency = (value: string | number) =>
    `UGX ${new Intl.NumberFormat("en-UG").format(Number(value))}`


  const receiptNumber = `PAY-${paymentId.slice(0, 8).toUpperCase()}`
  const loanReference = loan ? `LOAN-${loan.id.slice(0, 8).toUpperCase()}` : "—"

  return (
    <div className="container max-w-2xl mx-auto p-4 md:p-6 print:p-0 print:max-w-none print:container-none">
      {/* RCPT-03 blocked state */}
      {isBlocked && (
        <Alert variant="destructive" className="mb-4 print-hidden">
          <AlertTitle>Cannot print receipt</AlertTitle>
          <AlertDescription>
            The following required details are missing:{" "}
            {missingFields.join(", ")}. Update the loan or payment record to
            enable printing.
          </AlertDescription>
        </Alert>
      )}

      {/* Print button — hidden during print */}
      <div className="print:hidden flex justify-end mb-4">
        <PrintButton disabled={isBlocked} />
      </div>

      {/* Receipt body */}
      <div className="receipt-body bg-white text-black border border-border rounded-lg p-8 print:border-none print:rounded-none print:p-0">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-lg font-semibold tracking-tight">Payment Receipt</h1>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            {receiptNumber}
          </p>
        </div>

        <Separator className="mb-4" />

        {/* Receipt fields */}
        <dl className="space-y-3">
          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Date</dt>
            <dd className="text-sm">{formatDate(payment.paymentDate)}</dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Customer name</dt>
            <dd className="text-sm">{customer?.fullName ?? "—"}</dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Loan reference</dt>
            <dd className="font-mono text-xs">{loanReference}</dd>
          </div>

          <Separator />

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Payment amount</dt>
            <dd className="text-sm font-medium font-mono tabular-nums">
              {formatCurrency(payment.amount)}
            </dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Interest paid</dt>
            <dd className="text-sm font-mono tabular-nums">{formatCurrency(payment.interestPortion)}</dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Principal paid</dt>
            <dd className="text-sm font-mono tabular-nums">
              {formatCurrency(payment.principalPortion)}
            </dd>
          </div>

          <Separator />

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">
              Outstanding balance after payment
            </dt>
            <dd className="text-sm font-medium font-mono tabular-nums">
              {formatCurrency(payment.principalBalanceAfter)}
            </dd>
          </div>

          <Separator />

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Received by</dt>
            <dd className="text-sm">{recordingUser?.name ?? "—"}</dd>
          </div>
        </dl>

        {/* Footer */}
        <Separator className="mt-6 mb-4" />
        <p className="text-xs text-muted-foreground text-center">
          This is an official receipt from the lending system.
        </p>
      </div>
    </div>
  )
}
