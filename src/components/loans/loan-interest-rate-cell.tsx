"use client"

import { Badge } from "@/components/ui/badge"
import { formatRate } from "@/lib/utils"

interface LoanInterestRateCellProps {
  rate: string
  rateChanged: boolean
}

export function LoanInterestRateCell({ rate, rateChanged }: LoanInterestRateCellProps) {
  return (
    <div className="space-y-1">
      <span className="font-mono tabular-nums">{formatRate(rate, 1)} / month</span>
      {rateChanged && (
        <div>
          <Badge variant="secondary" className="text-[10px]">Rate changed</Badge>
        </div>
      )}
    </div>
  )
}
