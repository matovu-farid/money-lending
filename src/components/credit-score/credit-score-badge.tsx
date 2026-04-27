"use client"

import { useMemo } from "react"
import { useLiveQuery, eq } from "@tanstack/react-db"
import { loanCollection } from "@/collections/loans"
import { paymentCollection } from "@/collections/payments"
import { calculateCreditScore } from "@/lib/credit-score"
import type { PaymentWithCustomer } from "@/types"
import { InfoPopover } from "@/components/ui/info-popover"
import { cn } from "@/lib/utils"

interface CreditScoreBadgeProps {
  customerId: string
  className?: string
}

export function CreditScoreBadge({ customerId, className }: CreditScoreBadgeProps) {
  const { data: customerLoans } = useLiveQuery(
    (q) => q.from({ loan: loanCollection }).where(({ loan }) => eq(loan.customerId, customerId)),
    [customerId],
  )

  // Payments are now a raw row stream (no customerId). Filter client-side by
  // matching loanIds for this customer.
  const { data: allPayments } = useLiveQuery(
    (q) => q.from({ p: paymentCollection }).select(({ p }) => p),
    [],
  )

  const customerPayments = useMemo(() => {
    const loanIds = new Set((customerLoans ?? []).map((l) => l.id))
    return (allPayments ?? [])
      .filter((p) => loanIds.has(p.loanId))
      .map((p) => ({
        ...p,
        // calculateCreditScore only reads loanId + paymentDate
        customerId,
        customerName: "",
        interestPortion: "0",
        principalPortion: "0",
        principalBalanceAfter: "0",
        outstandingBalance: "0",
        recorderName: "",
      })) as unknown as PaymentWithCustomer[]
  }, [allPayments, customerLoans, customerId])

  const result = useMemo(
    () => calculateCreditScore(customerLoans ?? [], customerPayments),
    [customerLoans, customerPayments],
  )

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold",
          result.color,
        )}
      >
        {result.score !== null ? (
          <>
            <span className="font-mono tabular-nums">{result.score}</span>
            <span className="font-medium">{result.label}</span>
          </>
        ) : (
          <span className="font-medium">{result.label}</span>
        )}
      </div>
      <CreditScoreInfoPopover />
    </div>
  )
}

function CreditScoreInfoPopover() {
  return (
    <InfoPopover className="w-96">
      <div className="space-y-4 text-sm">
        <div>
          <p className="font-semibold mb-1">Credit Score</p>
          <p className="text-muted-foreground">
            Scores range from 300 (highest risk) to 850 (lowest risk), calculated from the customer&apos;s loan and payment history. Recent and larger loans influence the score more than older, smaller ones.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-semibold">Scoring Factors</p>

          <div>
            <p className="font-medium">Repayment Timeliness (35%)</p>
            <p className="text-muted-foreground">
              How consistently payments are made within 30-day cycles. Example: A customer who pays every 25–30 days scores higher than one who sometimes waits 60+ days.
            </p>
          </div>

          <div>
            <p className="font-medium">Loan Completion (25%)</p>
            <p className="text-muted-foreground">
              Ratio of fully paid loans. Example: 4 out of 5 loans fully paid = strong score. Loans settled with collateral lower this significantly.
            </p>
          </div>

          <div>
            <p className="font-medium">Borrowing History (20%)</p>
            <p className="text-muted-foreground">
              More completed loan cycles build trust. Example: A customer on their 5th loan scores higher than a first-time borrower.
            </p>
          </div>

          <div>
            <p className="font-medium">Balance Paydown (10%)</p>
            <p className="text-muted-foreground">
              How quickly principal is reduced. Paying off loans early earns a bonus. Example: Paying off a 3-month loan in 2 months = top score.
            </p>
          </div>

          <div>
            <p className="font-medium">Penalty Record (10%)</p>
            <p className="text-muted-foreground">
              Fewer penalties = better score. Example: 0 penalties across 3 loans = perfect score here.
            </p>
          </div>
        </div>

        <div>
          <p className="font-semibold mb-1">Score Ranges</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-green-700 dark:text-green-400 font-medium">800–850: Excellent</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-medium">740–799: Very Good</span>
            <span className="text-blue-700 dark:text-blue-400 font-medium">670–739: Good</span>
            <span className="text-amber-700 dark:text-amber-400 font-medium">580–669: Fair</span>
            <span className="text-orange-700 dark:text-orange-400 font-medium">450–579: Poor</span>
            <span className="text-red-700 dark:text-red-400 font-medium">300–449: Very Poor</span>
          </div>
        </div>
      </div>
    </InfoPopover>
  )
}
