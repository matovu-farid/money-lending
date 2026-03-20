import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { customers } from "@/lib/db/schema/customers"
import { user } from "@/lib/db/schema/auth"
import { eq } from "drizzle-orm"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { PrintButton } from "./print-button"

export default async function DisbursementReceiptPage({
  params,
}: {
  params: Promise<{ loanId: string }>
}) {
  const { loanId } = await params

  // Fetch loan record
  const [loan] = await db.select().from(loans).where(eq(loans.id, loanId))

  if (!loan) {
    return (
      <div className="container max-w-2xl mx-auto p-6">
        <Alert variant="destructive">
          <AlertTitle>Loan not found</AlertTitle>
          <AlertDescription>
            No loan record was found for the provided ID.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // Fetch related records in parallel
  const [[customer], [collateralRecord], [issuingUser]] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, loan.customerId)),
    db.select().from(collateral).where(eq(collateral.loanId, loanId)),
    db.select().from(user).where(eq(user.id, loan.issuedBy)),
  ])

  // RCPT-03 completeness check
  const missingFields: string[] = []
  if (!customer?.fullName) missingFields.push("Customer name")
  if (!customer?.contact) missingFields.push("Customer contact")
  if (!loan?.principalAmount) missingFields.push("Loan amount")
  if (!loan?.interestRate) missingFields.push("Interest rate")
  if (!collateralRecord?.nature) missingFields.push("Collateral details")

  const isBlocked = missingFields.length > 0

  // Format helpers
  const formatCurrency = (value: string | number) =>
    `UGX ${new Intl.NumberFormat("en-UG").format(Number(value))}`

  const formatDate = (date: Date | string) =>
    new Date(date).toLocaleDateString("en-UG", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })

  const receiptNumber = `LOAN-${loanId.slice(0, 8).toUpperCase()}`
  const interestRateDisplay = `${(parseFloat(loan.interestRate) * 100).toFixed(1)}% per month`
  const minPeriodDisplay = `${loan.minPeriodOverride ?? loan.minInterestDays} days`

  return (
    <div className="container max-w-2xl mx-auto p-6 print:p-0 print:max-w-none print:container-none">
      {/* RCPT-03 blocked state */}
      {isBlocked && (
        <Alert variant="destructive" className="mb-4 print-hidden">
          <AlertTitle>Cannot print receipt</AlertTitle>
          <AlertDescription>
            The following required details are missing:{" "}
            {missingFields.join(", ")}. Update the loan or customer record to
            enable printing.
          </AlertDescription>
        </Alert>
      )}

      {/* Print button — hidden during print */}
      <div className="print:hidden flex justify-end mb-4">
        <PrintButton
          disabled={isBlocked}
        />
      </div>

      {/* Receipt body */}
      <div className="receipt-body bg-white text-black border border-border rounded-lg p-8 print:border-none print:rounded-none print:p-0">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-lg font-semibold">Loan Disbursement Receipt</h1>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            {receiptNumber}
          </p>
        </div>

        <Separator className="mb-4" />

        {/* Receipt fields */}
        <dl className="space-y-3">
          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Date</dt>
            <dd className="text-sm">{formatDate(loan.startDate)}</dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Customer name</dt>
            <dd className="text-sm">{customer?.fullName ?? "—"}</dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Customer contact</dt>
            <dd className="text-sm">{customer?.contact ?? "—"}</dd>
          </div>

          <Separator />

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Loan amount</dt>
            <dd className="text-sm font-medium">
              {formatCurrency(loan.principalAmount)}
            </dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Interest rate</dt>
            <dd className="text-sm">{interestRateDisplay}</dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">
              Minimum interest period
            </dt>
            <dd className="text-sm">{minPeriodDisplay}</dd>
          </div>

          <Separator />

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">
              Collateral (nature)
            </dt>
            <dd className="text-sm">{collateralRecord?.nature ?? "—"}</dd>
          </div>

          {collateralRecord?.description && (
            <div className="flex justify-between">
              <dt className="text-xs text-muted-foreground">
                Collateral (description)
              </dt>
              <dd className="text-sm">{collateralRecord.description}</dd>
            </div>
          )}

          <Separator />

          <div className="flex justify-between">
            <dt className="text-xs text-muted-foreground">Issued by</dt>
            <dd className="text-sm">{issuingUser?.name ?? "—"}</dd>
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
