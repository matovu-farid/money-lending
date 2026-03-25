"use client"

import { useState } from "react"
import { Collapsible } from "@base-ui/react/collapsible"
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
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground md:hidden h-8 px-2"
        aria-label="Toggle filters"
      >
        <Filter size={16} />
        {label}
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs w-5 h-5">
            {activeCount}
          </span>
        )}
        <ChevronDown className={cn("h-4 w-4 transition-transform duration-150 ease-out", open && "rotate-180")} />
      </Collapsible.Trigger>
      <Collapsible.Panel data-slot="filter-panel-content" className="overflow-hidden md:!block">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
