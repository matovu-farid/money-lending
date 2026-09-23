"use client"

import { useSearchParams } from "next/navigation"
import { usePermissions } from "@/hooks/use-permissions"
import { currentKampalaWeek, parseWeeklyReportPeriod } from "@/lib/weekly-report-period"
import { WeeklyLoansClient } from "./WeeklyLoansClient"

export default function WeeklyLoansPage() {
  const searchParams = useSearchParams()
  const requestedWeek = searchParams.get("week")
  const week = requestedWeek ?? currentKampalaWeek()
  let valid = true
  try { parseWeeklyReportPeriod(week) } catch { valid = false }
  const { has } = usePermissions()
  if (!has("reports:read") || !has("loan:read")) {
    return <div className="space-y-2 p-4 md:p-6"><p className="font-medium text-destructive">Access denied.</p><p className="text-sm text-muted-foreground">You need report and loan read permissions to view this report.</p></div>
  }
  if (!valid) return <div className="space-y-2 p-4 md:p-6"><h1 className="text-2xl font-semibold">Weekly Loans</h1><p role="alert" className="text-sm text-destructive">Invalid week. Choose a valid Monday week start.</p></div>
  return <WeeklyLoansClient week={week} />
}
