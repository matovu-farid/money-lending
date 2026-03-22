import { Effect, Exit } from "effect"
import { getPortfolioData } from "@/services/report.service"
import { PortfolioClient } from "./PortfolioClient"
import type { PortfolioEntry } from "@/types"

export default async function PortfolioReportPage() {
  const exit = await Effect.runPromiseExit(getPortfolioData())
  const data: PortfolioEntry[] = Exit.isSuccess(exit) ? exit.value : []

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Loan Portfolio</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Active loans with interest accrued and risk flags
          </p>
        </div>
      </div>

      <PortfolioClient
        data={data}
        exportPdfHref="/api/reports/portfolio?format=pdf"
        exportExcelHref="/api/reports/portfolio?format=excel"
      />
    </div>
  )
}
