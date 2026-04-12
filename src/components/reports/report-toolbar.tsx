"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getMonthOptions } from "@/lib/utils"
import { downloadFromUrl } from "@/lib/download"

interface ReportToolbarProps {
  period?: string
  basePath: string
  showPeriodSelector?: boolean
  exportFormats?: ("pdf" | "excel")[]
  exportHref?: (format: "pdf" | "excel", period: string) => string
  exportFilename?: (format: "pdf" | "excel", period: string) => string
}

export function ReportToolbar({
  period,
  basePath,
  showPeriodSelector = true,
  exportFormats = ["pdf", "excel"],
  exportHref,
  exportFilename,
}: ReportToolbarProps) {
  const router = useRouter()
  const monthOptions = getMonthOptions()
  const [downloading, setDownloading] = useState<"pdf" | "excel" | null>(null)

  function handlePeriodChange(value: string | null) {
    if (value !== null) {
      router.push(`${basePath}?period=${value}`)
    }
  }

  async function handleDownload(format: "pdf" | "excel") {
    if (downloading) return
    if (!exportHref || !exportFilename) return
    setDownloading(format)
    const href = exportHref(format, period ?? "")
    const filename = exportFilename(format, period ?? "")
    try {
      await downloadFromUrl(href, filename)
    } catch {
      toast.error("Export failed. Please try again.")
    } finally {
      setDownloading(null)
    }
  }

  const showExportButtons = exportFormats.length > 0 && exportHref && exportFilename

  return (
    <div className="flex flex-wrap items-center gap-3">
      {showPeriodSelector && period && (
        <Select value={period} onValueChange={handlePeriodChange}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showExportButtons && exportFormats.includes("pdf") && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleDownload("pdf")}
          disabled={downloading !== null}
        >
          {downloading === "pdf" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {downloading === "pdf" ? "Exporting..." : "Export PDF"}
        </Button>
      )}

      {showExportButtons && exportFormats.includes("excel") && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleDownload("excel")}
          disabled={downloading !== null}
        >
          {downloading === "excel" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {downloading === "excel" ? "Exporting..." : "Export Excel"}
        </Button>
      )}
    </div>
  )
}
