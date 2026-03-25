"use client"

import { useState } from "react"
import { Filter, ChevronDown } from "lucide-react"
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
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground md:hidden h-8 px-2"
        aria-label="Toggle filters"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Filter size={16} />
        {label}
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs w-5 h-5">
            {activeCount}
          </span>
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
