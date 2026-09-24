"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { CurrencyCell } from "@/components/ui/currency-cell"
import { Button } from "@/components/ui/button"
import { WeeklyReportToolbar } from "@/components/reports/weekly-report-toolbar"
import { useWeeklyLoansReport } from "@/hooks/use-weekly-reports"
import { getWeeklyLoansReportAction } from "@/actions/report.actions"
import { buildWeeklyLoansPrintHtml, printHtml } from "@/components/reports/weekly-report-print"
import type { WeeklyLoansReportData, WeeklyLoansReportRow } from "@/types/weekly-report"
import { toast } from "sonner"

function formatKampalaDate(value: string | null) {
  if (!value) return "No payments"
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeZone: "Africa/Kampala" }).format(new Date(value))
}

function formatSnapshot(value: string) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" }).format(new Date(value))
}

export function WeeklyLoansClient({ week }: { week: string }) {
  const { data, isLoading, error, retry } = useWeeklyLoansReport(week)
  const report = data as WeeklyLoansReportData | undefined
  const hasError = Boolean(error)
  const [printing, setPrinting] = useState(false)
  const latestWeek = useRef(week)
  latestWeek.current = week
  const columns: Column<WeeklyLoansReportRow>[] = [
    { key: "customer", header: "Customer Name", primary: true, render: (row) => <span className="font-medium">{row.customerName}</span> },
    { key: "contact", header: "Contact", render: (row) => row.contactNumber || "—" },
    { key: "principal", header: "Principal Amount", align: "right", render: (row) => <CurrencyCell amount={row.principalAmount} /> },
    { key: "balance", header: "Principal Balance", align: "right", render: (row) => <CurrencyCell amount={row.principalBalance} /> },
    { key: "interest", header: "Accrued Interest", align: "right", render: (row) => <CurrencyCell amount={row.accruedInterest} /> },
    { key: "due", header: "Total Due", align: "right", render: (row) => <CurrencyCell amount={row.totalDue} /> },
    { key: "overdue", header: "Days Overdue", align: "right", render: (row) => row.daysOverdue },
    { key: "lastPayment", header: "Last Payment", render: (row) => formatKampalaDate(row.lastPaymentDate) },
  ]
  const canPrint = Boolean(report && report.week === week && report.rows.length > 0 && !isLoading && !hasError && !printing)

  const handlePrint = async () => {
    if (!canPrint) return
    setPrinting(true)
    try {
      const result = await getWeeklyLoansReportAction({ week })
      if ("error" in result || !result.data || result.data.week !== week) {
        toast.error("Could not refresh weekly loans for printing")
        return
      }
      if (result.data.rows.length === 0) {
        toast.info("No loans issued this week.")
        return
      }
      if (latestWeek.current !== week) return
      printHtml(buildWeeklyLoansPrintHtml(week, result.data.calculatedAt, result.data.rows))
    } catch {
      toast.error("Could not refresh weekly loans for printing")
    } finally {
      setPrinting(false)
    }
  }

  return <div className="space-y-5 p-4 md:p-6">
    <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Reports</Link>
    <header><h1 className="text-2xl font-semibold tracking-tight">Weekly Loans</h1><p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Loans issued during the selected Kampala week</p></header>
    <WeeklyReportToolbar week={week} basePath="/reports/weekly-loans" onPrint={() => void handlePrint()} printDisabled={!canPrint} printing={printing} />
    {isLoading && !hasError && <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading weekly loans…</p>}
    {hasError && <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center text-sm text-destructive"><p>Could not load weekly loans.</p><Button variant="outline" size="sm" onClick={() => void retry()}>Retry</Button></div>}
    {!isLoading && !hasError && report && <>
      {report.rows.length === 0
        ? <p className="py-8 text-center text-sm text-muted-foreground">No loans issued this week.</p>
        : <>
          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border bg-card p-4 text-sm"><p>Loans issued <strong className="ml-1 tabular-nums">{report.count}</strong></p><p>Principal total <strong className="ml-1"><CurrencyCell amount={report.total} /></strong></p></div>
          <p className="text-xs text-muted-foreground">Balances and interest are current as of {formatSnapshot(report.calculatedAt)}. Closed loans follow the current report convention: zero balance and interest.</p>
          <ResponsiveTable columns={columns} rows={report.rows} getRowKey={(row) => row.id} />
        </>}
    </>}
  </div>
}
