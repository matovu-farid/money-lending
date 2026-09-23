"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { parseWeeklyReportPeriod, shiftKampalaWeek } from "@/lib/weekly-report-period"

export function weeklyRangeLabel(week: string) {
  const { endLocalDate } = parseWeeklyReportPeriod(week)
  const format = (value: string) => new Intl.DateTimeFormat("en-UG", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
  return `${format(week)} – ${format(endLocalDate)}`
}

function mondayOf(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

export function WeeklyReportToolbar({ week, basePath, onPrint, printDisabled, printing }: { week: string; basePath: string; onPrint?: () => void; printDisabled?: boolean; printing?: boolean }) {
  const router = useRouter()
  const navigate = (nextWeek: string) => router.replace(`${basePath}?week=${encodeURIComponent(nextWeek)}`)

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <Button variant="outline" size="sm" aria-label="Previous week" onClick={() => navigate(shiftKampalaWeek(week, -1))}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Previous week
      </Button>
      <div className="min-w-40">
        <label htmlFor="weekly-report-week" className="mb-1 block text-xs font-medium text-muted-foreground">Week starting (Monday)</label>
        <input
          id="weekly-report-week"
          type="date"
          value={week}
          onChange={(event) => {
            const monday = mondayOf(event.currentTarget.value)
            if (monday) navigate(monday)
          }}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        />
      </div>
      <Button variant="outline" size="sm" aria-label="Next week" onClick={() => navigate(shiftKampalaWeek(week, 1))}>
        Next week <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
      {onPrint && <Button variant="outline" size="sm" onClick={onPrint} disabled={printDisabled} loading={printing}>
        <span aria-label="Print">Print</span>
      </Button>}
      <p className="ml-auto w-full text-sm font-medium sm:w-auto" aria-live="polite">{weeklyRangeLabel(week)}</p>
    </div>
  )
}
