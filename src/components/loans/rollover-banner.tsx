"use client"

import { AlertTriangle } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { shortId } from "@/lib/utils"
import { CurrencyCell } from "@/components/ui/currency-cell"
import BigNumber from "bignumber.js"

interface RolloverBannerProps {
  loanId: string
  customerName: string
  outstandingPrincipal: string
  accruedInterest: string
}

export function RolloverBanner({
  loanId,
  customerName,
  outstandingPrincipal,
  accruedInterest,
}: RolloverBannerProps) {
  const totalCarryOver = new BigNumber(outstandingPrincipal)
    .plus(new BigNumber(accruedInterest))
    .toFixed(0)

  const loanRef = `LOAN-${shortId(loanId).toUpperCase()}`

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold text-sm text-orange-900">
            {customerName} has an active loan ({loanRef})
          </p>
          <p className="text-sm text-orange-700 mt-1">
            The existing loan will be rolled over into the new one. The outstanding balance will be added to the new loan&apos;s principal.
          </p>
        </div>
      </div>

      <div className="rounded-md border border-orange-200 bg-white p-3 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Outstanding Principal</span>
          <CurrencyCell amount={outstandingPrincipal} className="font-medium" />
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Accrued Interest</span>
          <CurrencyCell amount={accruedInterest} className="font-medium" />
        </div>
        <Separator />
        <div className="flex justify-between font-semibold">
          <span>Amount to Roll Over</span>
          <CurrencyCell amount={totalCarryOver} />
        </div>
      </div>

      <p className="text-xs text-orange-600">
        Requires supervisor or above authorization. The fresh disbursement amount you enter below will have the rollover amount added to it.
      </p>
    </div>
  )
}
