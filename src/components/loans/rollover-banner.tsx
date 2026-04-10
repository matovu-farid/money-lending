"use client"

import { AlertTriangle } from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { formatCurrency } from "@/lib/utils"
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

  const loanRef = `LOAN-${loanId.slice(0, 8).toUpperCase()}`

  return (
    <Alert className="border-orange-200 bg-orange-50 text-orange-900 space-y-3 [&>svg]:text-orange-600">
      <AlertTriangle />
      <AlertTitle>
        {customerName} has an active loan ({loanRef})
      </AlertTitle>
      <AlertDescription className="text-orange-700">
        The existing loan will be rolled over into the new one. The outstanding balance will be added to the new loan&apos;s principal.
      </AlertDescription>

      <Card className="border-orange-200">
        <CardContent className="p-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Outstanding Principal</span>
            <span className="font-medium">{formatCurrency(outstandingPrincipal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Accrued Interest</span>
            <span className="font-medium">{formatCurrency(accruedInterest)}</span>
          </div>
          <Separator className="my-1.5" />
          <div className="flex justify-between font-semibold">
            <span>Amount to Roll Over</span>
            <span>{formatCurrency(totalCarryOver)}</span>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-orange-600">
        Requires supervisor or above authorization. The fresh disbursement amount you enter below will have the rollover amount added to it.
      </p>
    </Alert>
  )
}
