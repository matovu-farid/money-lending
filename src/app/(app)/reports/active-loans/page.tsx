import { listActiveLoansWithOverdueAction } from "@/actions/loan.actions"
import ActiveLoansClient from "./ActiveLoansClient"

export default async function ActiveLoansReportPage() {
  const result = await listActiveLoansWithOverdueAction()
  const data = "data" in result && result.data ? result.data : []

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Active Loans Report</h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
            Overview of all currently active loans
          </p>
        </div>
      </div>

      <ActiveLoansClient data={data} />
    </div>
  )
}
