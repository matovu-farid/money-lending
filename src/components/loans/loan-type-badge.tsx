/**
 * Shared loan type badge (Fixed Rate / Reducing Bal. / Perpetual).
 * Used in the loans list page and customer loan cards.
 */

const LOAN_TYPE_STYLES: Record<string, string> = {
  fixed_rate: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  reducing_balance: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
}

const LOAN_TYPE_LABELS: Record<string, string> = {
  fixed_rate: "Fixed Rate",
  reducing_balance: "Reducing Bal.",
}

export function LoanTypeBadge({ loanType }: { loanType: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        LOAN_TYPE_STYLES[loanType] ?? "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
      }`}
    >
      {LOAN_TYPE_LABELS[loanType] ?? "Perpetual"}
    </span>
  )
}
