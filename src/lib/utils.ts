import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, formatDistanceToNow } from "date-fns"

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

  let parts = cleaned.split(".")
  if (parts.length > 2) {
    // Multiple dots: keep only first dot, discard everything after second dot
    parts = [parts[0], parts[1]]
  }
  // Format integer part with commas
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  if (parts.length > 1) {
    return `${intPart}.${parts[1]}`
  }
  return intPart
}

/**
 * Strip commas from a formatted number string to get the raw numeric value.
 */
export function stripCommas(value: string): string {
  return value.replace(/,/g, "")
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
 * Get the YYYY-MM string for the last fully completed calendar month.
 */
export function getLastCompletedMonth(): string {
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`
}
