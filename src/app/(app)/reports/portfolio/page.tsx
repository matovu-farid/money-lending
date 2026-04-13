import { PortfolioClient } from "./PortfolioClient"

export default function PortfolioReportPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio Report</h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
            Loan portfolio analysis
          </p>
        </div>
      </div>
      <PortfolioClient />
    </div>
  )
}
