"use client"

import { useState } from "react"
import { Filter, ChevronDown } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface FilterPanelProps {
  children: React.ReactNode
  label?: string
  activeCount?: number
}

export function FilterPanel({ children, label = "Filters", activeCount = 0 }: FilterPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      {/* Toggle button — visible on mobile only (md:hidden) */}
      <button
        type="button"
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground md:hidden h-8 min-h-[44px] px-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-md"
        aria-label="Toggle filters"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Filter size={16} />
        {label}
        {activeCount > 0 && (
          <Badge className="rounded-full min-w-5 justify-center px-1">
            {activeCount}
          </Badge>
        )}
        <ChevronDown className={cn("h-4 w-4 transition-transform duration-150 ease-out", open && "rotate-180")} />
      </button>

      {/* Panel:
          - Mobile: shown when `open` is true, hidden otherwise
          - Desktop (md+): always shown regardless of `open` state via md:!block
          Using overflow-hidden only on mobile collapsed state to prevent layout shift. */}
      <div
        data-slot="filter-panel-content"
        className={cn(
          "md:!block",
          open ? "block" : "hidden"
        )}
      >
        {children}
      </div>
    </div>
  )
}
