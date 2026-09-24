import { formatCurrency } from "@/lib/utils"

/** Weekly reports already identify the currency context, so show only the amount. */
export function formatWeeklyReportAmount(amount: string | number | null | undefined): string {
  return formatCurrency(amount).replace(/^UGX\s*/, "")
}
