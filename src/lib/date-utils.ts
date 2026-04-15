/**
 * UTC-based period boundary construction for financial reports.
 * All boundaries are in UTC to match PostgreSQL timestamptz storage.
 */

/**
 * Given a "YYYY-MM" period string, returns UTC-based start and end dates.
 * - periodStart: first day of month at 00:00:00.000 UTC
 * - periodEnd: last day of month at 23:59:59.999 UTC
 */
export function periodBoundsUTC(period: string): { periodStart: Date; periodEnd: Date } {
  const [year, month] = period.split("-").map(Number)
  const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  // Day 0 of next month = last day of current month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const periodEnd = new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999))
  return { periodStart, periodEnd }
}

/**
 * Given a specific date string (YYYY-MM-DD or YYYY-MM), returns a UTC
 * "as of" date at end of day (23:59:59.999 UTC).
 */
export function asOfDateUTC(asOf: string): Date {
  if (/^\d{4}-\d{2}$/.test(asOf)) {
    return periodBoundsUTC(asOf).periodEnd
  }
  const [year, month, day] = asOf.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
}
