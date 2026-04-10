/**
 * Shared loan type badge (Fixed Rate / Reducing Bal. / Perpetual).
 * Used in the loans list page and customer loan cards.
 */

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const LOAN_TYPE_STYLES: Record<string, string> = {
  fixed_rate: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800",
  reducing_balance: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-800",
}

const LOAN_TYPE_LABELS: Record<string, string> = {
  fixed_rate: "Fixed Rate",
  reducing_balance: "Reducing Bal.",
}

export function LoanTypeBadge({ loanType }: { loanType: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full",
        LOAN_TYPE_STYLES[loanType] ?? "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-800"
      )}
    >
      {LOAN_TYPE_LABELS[loanType] ?? "Perpetual"}
    </Badge>
  )
}
