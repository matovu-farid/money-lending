"use client"

import { useSearchParams } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { currentKampalaWeek, isFutureKampalaWeek, parseWeeklyReportPeriod } from "@/lib/weekly-report-period"
import { WeeklyPaymentsClient } from "./WeeklyPaymentsClient"

export default function WeeklyPaymentsPage() {
  const searchParams = useSearchParams()
  const requestedWeek = searchParams.get("week")
  const week = requestedWeek ?? currentKampalaWeek()
  let valid = true
  try { parseWeeklyReportPeriod(week) } catch { valid = false }
  const future = valid && isFutureKampalaWeek(week)
  const { has } = usePermissions()
  if (!has("reports:read") || !has("payment:read")) {
    return <div className="space-y-2 p-4 md:p-6"><p className="font-medium text-destructive">Access denied.</p><p className="text-sm text-muted-foreground">You need report and payment read permissions to view this report.</p></div>
  }
  if (!valid) return <div className="space-y-2 p-4 md:p-6"><h1 className="text-2xl font-semibold">Weekly Payments</h1><p role="alert" className="text-sm text-destructive">Invalid week. Choose a valid Monday week start.</p></div>
  if (future) return <div className="space-y-2 p-4 md:p-6"><h1 className="text-2xl font-semibold">Weekly Payments</h1><p role="alert" className="text-sm text-destructive">Future weeks are not available.</p></div>
  return <WeeklyPaymentsClient week={week} />
}
