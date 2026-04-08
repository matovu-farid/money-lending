import { db } from "@/lib/db"
import { payments } from "@/lib/db/schema/payments"
import { loans } from "@/lib/db/schema/loans"
import { customers } from "@/lib/db/schema/customers"
import { user } from "@/lib/db/schema/auth"
import { eq } from "drizzle-orm"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { PrintButton } from "@/app/(app)/receipts/disbursement/[loanId]/print-button"
import { formatDate } from "@/lib/utils"
import { getPaymentPortionsFromLedger, getLoanBalanceFromLedger } from "@/services/transaction.service"

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

  // Derive interest/principal portions from ledger
  const portionsMap = await getPaymentPortionsFromLedger([paymentId])
  const portions = portionsMap.get(paymentId) ?? { interestPortion: "0", principalPortion: "0" }
  const ledgerBalance = loan ? await getLoanBalanceFromLedger(loan.id) : null
  const balanceAfter = ledgerBalance?.toFixed(0) ?? loan?.principalAmount ?? "0"

  // RCPT-03 completeness check
  const missingFields: string[] = []
  if (!customer?.fullName) missingFields.push("Customer name")
  if (!payment?.amount) missingFields.push("Payment amount")
  if (!loan?.id) missingFields.push("Loan reference")

  const isBlocked = missingFields.length > 0

  // Format helpers
  const formatCurrency = (value: string | number) =>
    `UGX ${new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(Number(value))}`


  const receiptNumber = `PAY-${paymentId.slice(0, 8).toUpperCase()}`
  const loanReference = loan ? `LOAN-${loan.id.slice(0, 8).toUpperCase()}` : "\u2014"

  return (
    <div className="min-h-screen bg-muted print:bg-white print:min-h-0">
      <div className="container max-w-[560px] mx-auto p-4 md:p-8 print:p-0 print:max-w-none print:container-none">
        {/* RCPT-03 blocked state */}
        {isBlocked && (
          <Alert variant="destructive" className="mb-4 print:hidden">
            <AlertTitle>Cannot print receipt</AlertTitle>
            <AlertDescription>
              The following required details are missing:{" "}
              {missingFields.join(", ")}. Update the loan or payment record to
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
              Payment Receipt
            </p>
          </div>

          <div className="flex items-center justify-between mt-4 mb-0">
            <span className="font-mono text-xs font-semibold tracking-wide">
              {receiptNumber}
            </span>
            <span className="text-xs text-gray-600">
              {formatDate(payment.paymentDate)}
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
                  <td className="py-1 text-gray-500 align-top">Loan Reference</td>
                  <td className="py-1 text-right font-mono text-xs">{loanReference}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <hr className="border-gray-200 my-4 print:border-gray-400" />

          {/* Payment Breakdown */}
          <div className="mb-1">
            <h2 className="text-[10px] font-semibold tracking-[0.12em] uppercase text-gray-400 mb-2">
              Payment Breakdown
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-gray-500 align-top w-[40%]">Amount Paid</td>
                  <td className="py-1 text-right font-bold font-mono tabular-nums text-base">
                    {formatCurrency(payment.amount)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-gray-500 align-top">Interest Portion</td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {formatCurrency(portions.interestPortion)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 text-gray-500 align-top">Principal Portion</td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {formatCurrency(portions.principalPortion)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <hr className="border-gray-200 my-4 print:border-gray-400" />

          {/* Balance */}
          <div className="mb-1">
            <h2 className="text-[10px] font-semibold tracking-[0.12em] uppercase text-gray-400 mb-2">
              Balance
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 text-gray-500 align-top w-[40%]">Principal Balance</td>
                  <td className="py-1 text-right font-bold font-mono tabular-nums">
                    {formatCurrency(balanceAfter)}
                  </td>
                </tr>
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
                  <td className="py-1 text-gray-500 align-top w-[40%]">Received By</td>
                  <td className="py-1 text-right font-medium">{recordingUser?.name ?? "\u2014"}</td>
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
