"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export function Spinner({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <span
      data-testid="spinner"
      className={cn("inline-flex items-center gap-2", className)}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      {children}
    </span>
  )
}
