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
    <Card interactive>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">{label}{labelExtra}</p>
            {loading ? (
              <div className="h-8 w-32 rounded bg-muted-foreground/10 animate-pulse" />
            ) : (
              <p className={cn("text-2xl font-semibold font-mono tracking-tight tabular-nums", valueClassName)}>
                {value}
              </p>
            )}
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  )
}
