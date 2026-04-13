import { db } from "@/lib/db"
import { loans } from "@/lib/db/schema/loans"
import { collateral } from "@/lib/db/schema/collateral"
import { customers } from "@/lib/db/schema/customers"
import { user } from "@/lib/db/schema/auth"
import { eq } from "drizzle-orm"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { PrintButton } from "./print-button"
import { formatDate, formatRate, shortId } from "@/lib/utils"
import { getBaseRate } from "@/lib/interest/effective-rate"

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
      <div className="container max-w-2xl mx-auto p-4 md:p-6">
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
    `UGX ${new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(Number(value))}`


  const receiptNumber = `LOAN-${shortId(loanId).toUpperCase()}`
  const interestRateDisplay = `${formatRate(getBaseRate(loan), 1)} per month`
  const minPeriodDisplay = `${loan.minPeriodOverride ?? loan.minInterestDays} days`

  return (
    <div className="min-h-screen bg-muted print:bg-white print:min-h-0">
      <div className="container max-w-[560px] mx-auto p-4 md:p-8 print:p-0 print:max-w-none print:container-none">
        {/* RCPT-03 blocked state */}
        {isBlocked && (
          <Alert variant="destructive" className="mb-4 print:hidden">
            <AlertTitle>Cannot print receipt</AlertTitle>
            <AlertDescription>
              The following required details are missing:{" "}
              {missingFields.join(", ")}. Update the loan or customer record to
              enable printing.
            </AlertDescription>
          </Alert>
        )}

        {/* Print button — hidden during print */}
        <div className="print:hidden mb-6">
          <PrintButton disabled={isBlocked} />
        </div>

        {/* Receipt body */}
        <div className="receipt-body bg-white text-black border border-border rounded-lg shadow-sm p-8 md:p-10 print:border-none print:rounded-none print:shadow-none print:p-0">
          {/* Header */}
          <div className="text-center mb-0">
            <h1 className="text-base font-bold tracking-[0.25em] uppercase font-sans">
              Sovereign Ledger
            </h1>
            <p className="text-[11px] tracking-[0.08em] uppercase text-gray-500 mt-1">
              Loan Disbursement Receipt
            </p>
          </div>

          <div className="flex items-center justify-between mt-4 mb-0">
            <span className="font-mono text-xs font-semibold tracking-wide">
              {receiptNumber}
            </span>
            <span className="text-xs text-gray-600">
              {formatDate(loan.startDate)}
            </span>
          </div>

          <hr className="border-black mt-3 mb-5" />

          {/* Customer Details */}
          <div className="mb-1">
            <h2 className="text-[10px] font-semibold tracking-[0.12em] uppercase text-gray-400 mb-2">
              Customer Details
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-gray-500 align-top w-[40%]">Name</td>
                  <td className="py-1 text-right font-medium">{customer?.fullName ?? "\u2014"}</td>
                </tr>
                <tr>
                  <td className="py-1 text-gray-500 align-top">Contact</td>
                  <td className="py-1 text-right">{customer?.contact ?? "\u2014"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <hr className="border-gray-200 my-4 print:border-gray-400" />

          {/* Loan Details */}
          <div className="mb-1">
            <h2 className="text-[10px] font-semibold tracking-[0.12em] uppercase text-gray-400 mb-2">
              Loan Details
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-gray-500 align-top w-[40%]">Loan Amount</td>
                  <td className="py-1 text-right font-bold font-mono tabular-nums text-base">
                    {formatCurrency(loan.principalAmount)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-gray-500 align-top">Interest Rate</td>
                  <td className="py-1 text-right">{interestRateDisplay}</td>
                </tr>
                <tr>
                  <td className="py-1 text-gray-500 align-top">Min. Interest Period</td>
                  <td className="py-1 text-right">{minPeriodDisplay}</td>
                </tr>
                <tr>
                  <td className="py-1 text-gray-500 align-top">Issuance Fee</td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {formatCurrency(loan.issuanceFee)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <hr className="border-gray-200 my-4 print:border-gray-400" />

          {/* Collateral */}
          <div className="mb-1">
            <h2 className="text-[10px] font-semibold tracking-[0.12em] uppercase text-gray-400 mb-2">
              Collateral
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-gray-500 align-top w-[40%]">Nature</td>
                  <td className="py-1 text-right">{collateralRecord?.nature ?? "\u2014"}</td>
                </tr>
                {collateralRecord?.description && (
                  <tr>
                    <td className="py-1 text-gray-500 align-top">Description</td>
                    <td className="py-1 text-right">
                      <span className="inline-block max-w-[280px] truncate align-bottom">{collateralRecord.description}</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <hr className="border-gray-200 my-4 print:border-gray-400" />

          {/* Officer */}
          <div className="mb-0">
            <h2 className="text-[10px] font-semibold tracking-[0.12em] uppercase text-gray-400 mb-2">
              Officer
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-gray-500 align-top w-[40%]">Issued By</td>
                  <td className="py-1 text-right font-medium">{issuingUser?.name ?? "\u2014"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Signature lines */}
          <div className="mt-10 grid grid-cols-2 gap-8">
            <div>
              <div className="border-b border-black mb-1 h-8" />
              <p className="text-[10px] text-gray-500 text-center">Customer Signature</p>
            </div>
            <div>
              <div className="border-b border-black mb-1 h-8" />
              <p className="text-[10px] text-gray-500 text-center">Officer Signature</p>
            </div>
          </div>

          {/* Footer */}
          <hr className="border-black mt-8 mb-3" />
          <p className="text-[10px] text-gray-400 text-center">
            Sovereign Ledger &mdash; Official Receipt
          </p>
          <p className="text-[9px] text-gray-400 text-center mt-1">
            Printed on {new Date().toLocaleDateString("en-UG", { year: "numeric", month: "long", day: "numeric" })} at {new Date().toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>
    </div>
  )
}
