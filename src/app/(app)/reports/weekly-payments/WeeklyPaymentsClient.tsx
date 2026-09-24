"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table"
import { CurrencyCell } from "@/components/ui/currency-cell"
import { Button } from "@/components/ui/button"
import { WeeklyReportToolbar } from "@/components/reports/weekly-report-toolbar"
import { useWeeklyPaymentsReport } from "@/hooks/use-weekly-reports"
import { getWeeklyPaymentsReportAction } from "@/actions/report.actions"
import { buildWeeklyPaymentsPrintHtml, printHtml } from "@/components/reports/weekly-report-print"
import type { WeeklyPaymentsReportData, WeeklyPaymentsReportRow } from "@/types/weekly-report"
import { toast } from "sonner"

function formatKampalaDateTime(value: string) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" }).format(new Date(value))
}

function formatSnapshot(value: string) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" }).format(new Date(value))
}

export function WeeklyPaymentsClient({ week }: { week: string }) {
  const { data, isLoading, error, retry } = useWeeklyPaymentsReport(week)
  const report = data as WeeklyPaymentsReportData | undefined
  const hasError = Boolean(error)
  const [printing, setPrinting] = useState(false)
  const latestWeek = useRef(week)
  latestWeek.current = week
  const columns: Column<WeeklyPaymentsReportRow>[] = [
    { key: "customer", header: "Customer", primary: true, render: (row) => <span className="font-medium">{row.customerName}</span> },
    { key: "date", header: "Date", render: (row) => <span className="tabular-nums">{formatKampalaDateTime(row.paymentDate)}</span> },
    { key: "amount", header: "Amount", align: "right", render: (row) => <CurrencyCell amount={row.amount} /> },
    { key: "interest", header: "Interest", align: "right", render: (row) => <CurrencyCell amount={row.interestPortion} /> },
    { key: "principal", header: "Principal", align: "right", render: (row) => <CurrencyCell amount={row.principalPortion} /> },
    { key: "balance", header: "Principal Balance", align: "right", render: (row) => <CurrencyCell amount={row.principalBalanceAfter} /> },
  ]
  const canPrint = Boolean(report && report.week === week && report.rows.length > 0 && !isLoading && !hasError && !printing)

  const handlePrint = async () => {
    if (!canPrint) return
    setPrinting(true)
    try {
      const result = await getWeeklyPaymentsReportAction({ week })
      if ("error" in result || !result.data || result.data.week !== week) {
        toast.error("Could not refresh weekly payments for printing")
        return
      }
      if (result.data.rows.length === 0) {
        toast.info("No payments for this week.")
        return
      }
      if (latestWeek.current !== week) return
      printHtml(buildWeeklyPaymentsPrintHtml(week, result.data.calculatedAt, result.data.rows))
    } catch {
      toast.error("Could not refresh weekly payments for printing")
    } finally {
      setPrinting(false)
    }
  }

  return <div className="space-y-5 p-4 md:p-6">
    <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Reports</Link>
    <header><h1 className="text-2xl font-semibold tracking-tight">Weekly Payments</h1><p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payments received during the selected Kampala week</p></header>
    <WeeklyReportToolbar week={week} basePath="/reports/weekly-payments" onPrint={() => void handlePrint()} printDisabled={!canPrint} printing={printing} />
    {isLoading && !hasError && <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading weekly payments…</p>}
    {hasError && <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center text-sm text-destructive"><p>Could not load weekly payments.</p><Button variant="outline" size="sm" onClick={() => void retry()}>Retry</Button></div>}
    {!isLoading && !hasError && report && <>
      {report.rows.length === 0
        ? <p className="py-8 text-center text-sm text-muted-foreground">No payments for this week.</p>
        : <>
          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border bg-card p-4 text-sm"><p>Payments <strong className="ml-1 tabular-nums">{report.count}</strong></p><p>Total received <strong className="ml-1"><CurrencyCell amount={report.total} /></strong></p></div>
          <p className="text-xs text-muted-foreground">Payment allocations and balances are shown as recorded for each payment. As of {formatSnapshot(report.calculatedAt)}.</p>
          <ResponsiveTable columns={columns} rows={report.rows} getRowKey={(row) => row.id} />
        </>}
    </>}
  </div>
}
