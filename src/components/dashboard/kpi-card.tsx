"use client"

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface KpiCardProps {
  label: string
  value: string
  icon: LucideIcon
  subtitle?: string
  valueClassName?: string
  loading?: boolean
  labelExtra?: ReactNode
}

export function KpiCard({ label, value, icon: Icon, subtitle, valueClassName, loading, labelExtra }: KpiCardProps) {

  return (
    <Card interactive data-testid="kpi-card" data-kpi-label={label}>
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 text-muted-foreground">
            <Icon className="h-4 w-4 shrink-0" />
            <p className="text-sm font-medium inline-flex items-center gap-1">{label}{labelExtra}</p>
          </div>
          {loading ? (
            <div className="h-9 w-32 rounded bg-muted-foreground/10 animate-pulse" />
          ) : (
            <p data-testid="kpi-value" className={cn("text-3xl font-semibold tracking-tight tabular-nums", valueClassName)}>
              {value}
            </p>
          )}
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
