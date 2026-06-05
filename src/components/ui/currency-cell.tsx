import { cn, formatCurrency } from "@/lib/utils"

interface CurrencyCellProps {
  amount: string | number | null | undefined
  className?: string
}

/**
 * Renders a UGX currency amount with monospace, tabular-aligned digits.
 * Use this for any table cell, summary row, or label that displays a
 * financial figure so columns line up across rows and currency formatting
 * stays consistent across the app.
 *
 * Null / undefined / non-finite values render as "UGX —" (see formatCurrency).
 */
export function CurrencyCell({ amount, className }: CurrencyCellProps): React.JSX.Element {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {formatCurrency(amount)}
    </span>
  )
}
