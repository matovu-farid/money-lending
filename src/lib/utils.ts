import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, formatDistanceToNow } from "date-fns"
import { SHORT_ID_LENGTH } from "@/lib/constants"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a numeric string with thousands separators (commas).
 * Handles decimals: only the integer part gets commas.
 * Non-numeric characters (except dots) are stripped first.
 */
export function formatNumberWithCommas(value: string): string {
  // Strip everything except digits and dots
  const cleaned = value.replace(/[^0-9.]/g, "")
  if (!cleaned) return ""

  // UGX has no cents — strip any decimal part and format integer only
  const intOnly = cleaned.split(".")[0]
  return intOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/**
 * Strip commas from a formatted number string to get the raw numeric value.
 */
export function stripCommas(value: string): string {
  return value.replace(/,/g, "")
}

/**
 * Today's date as a YYYY-MM-DD string in the user's local timezone.
 * Avoids the UTC-shift bug where `new Date().toISOString().split("T")[0]`
 * returns yesterday when the local time is past midnight but still the
 * previous day in UTC.
 */
export function todayDateString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Format a date for human-readable display (e.g. "Mar 22, 2026").
 * Returns "—" for null/undefined values.
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—"
  const d = typeof date === "string" ? new Date(date) : date
  if (isNaN(d.getTime())) return "—"
  return format(d, "MMM d, yyyy")
}

/**
 * Format a date with time for human-readable display (e.g. "Mar 22, 2026, 3:45 PM").
 */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—"
  const d = typeof date === "string" ? new Date(date) : date
  if (isNaN(d.getTime())) return "—"
  return format(d, "MMM d, yyyy, h:mm a")
}

/**
 * Format a currency amount with UGX prefix and thousands separators.
 * Canonical currency formatter — use this everywhere instead of local formatUGX.
 */
export function formatCurrency(amount: string | number | null | undefined): string {
  if (amount == null) return "UGX —"
  const num = typeof amount === "string" ? Number(amount) : amount
  if (!Number.isFinite(num)) return "UGX —"
  return `UGX ${new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 0 }).format(num)}`
}

/**
 * Format a relative time string (e.g. "2 hours ago", "just now").
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return formatDistanceToNow(d, { addSuffix: true })
}

/**
 * Format a decimal rate string as a human-readable percentage.
 * e.g. "0.10" → "10%", "0.085" → "8.5%"
 */
export function formatRate(decimalRate: string | number, decimals = 0): string {
  const num = (typeof decimalRate === "string" ? parseFloat(decimalRate) : decimalRate) * 100
  return `${num.toFixed(decimals)}%`
}

/**
 * Get the YYYY-MM string for the last fully completed calendar month.
 */
export function getLastCompletedMonth(): string {
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`
}

/**
 * Get the YYYY-MM string for the current calendar month.
 */
export function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

/**
 * Generate month options for report period selectors.
 * Returns the last `count` months as { value: "YYYY-MM", label: "Month Year" } pairs.
 */
export function getMonthOptions(count = 12): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const label = d.toLocaleDateString("en-UG", { month: "long", year: "numeric" })
    options.push({ value, label })
  }
  return options
}

/**
 * Format a "YYYY-MM" period string as a human-readable date.
 * position "start" → first day of the month, "end" → last day of the month.
 */
export function formatPeriodDate(period: string, position: "start" | "end"): string {
  const [year, month] = period.split("-").map(Number)
  const date = position === "start"
    ? new Date(year, month - 1, 1)
    : new Date(year, month, 0)
  return date.toLocaleDateString("en-UG", { month: "long", day: "numeric", year: "numeric" })
}

/**
 * Truncate a UUID to a short human-readable identifier.
 */
export function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH)
}
