"use client"

import * as React from "react"
import { Info } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface InfoPopoverProps {
  children: React.ReactNode
  className?: string
}

export function InfoPopover({ children, className }: InfoPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={<span role="button" tabIndex={0} />}
        nativeButton={false}
        className="inline-flex items-center justify-center cursor-help text-muted-foreground hover:text-foreground transition-colors"
        aria-label="More information"
        onClick={(e) => e.stopPropagation()}
      >
        <Info className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-80 max-h-96 overflow-y-auto p-4", className)}
        side="bottom"
        align="start"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
