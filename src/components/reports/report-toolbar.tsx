"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getMonthOptions } from "@/lib/utils"
import { downloadBlob } from "@/lib/download"

interface ReportToolbarProps {
  period?: string
  basePath: string
  showPeriodSelector?: boolean
  exportFormats?: ("pdf" | "excel")[]
  onExport?: (format: "pdf" | "excel") => Promise<{ blob: Blob; filename: string }>
}

export function ReportToolbar({
  period,
  basePath,
  showPeriodSelector = true,
  exportFormats = ["pdf", "excel"],
  onExport,
}: ReportToolbarProps) {
  const router = useRouter()
  const monthOptions = getMonthOptions()
  const [downloading, setDownloading] = useState<"pdf" | "excel" | null>(null)

  function handlePeriodChange(value: string | null) {
    if (value !== null) {
      // replace instead of push so period changes don't pollute browser history
      router.replace(`${basePath}?period=${value}`)
    }
  }

  async function handleDownload(format: "pdf" | "excel") {
    if (downloading || !onExport) return
    setDownloading(format)
    try {
      const { blob, filename } = await onExport(format)
      downloadBlob(blob, filename)
    } catch {
      toast.error("Export failed. Please try again.")
    } finally {
      setDownloading(null)
    }
  }

  const showExportButtons = exportFormats.length > 0 && onExport

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mr-1"
      >
        <ArrowLeft className="h-4 w-4" />
        Reports
      </Link>
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
