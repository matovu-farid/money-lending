"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface DatePickerProps {
  /** yyyy-MM-dd string, or empty string when unset. */
  value: string | undefined
  /** Receives a yyyy-MM-dd string (empty string when cleared). */
  onChange: (value: string) => void
  id?: string
  name?: string
  disabled?: boolean
  className?: string
  /** Inclusive lower bound, yyyy-MM-dd. */
  min?: string
  /** Inclusive upper bound, yyyy-MM-dd. */
  max?: string
  placeholder?: string
  /** Trigger button height. Defaults to "default" (h-9). Use "sm" for h-8 filter rows. */
  size?: "default" | "sm"
  /** PopoverContent alignment. Defaults to "start". */
  align?: "start" | "center" | "end"
  /** Display format for the trigger label. Defaults to "PP" (e.g. "May 7, 2026"). */
  displayFormat?: string
  "aria-label"?: string
}

function parseDateString(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value + "T12:00:00")
  return isNaN(date.getTime()) ? undefined : date
}

export function DatePicker({
  value,
  onChange,
  id,
  name,
  disabled,
  className,
  min,
  max,
  placeholder = "Pick a date",
  size = "default",
  align = "start",
  displayFormat = "PP",
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = parseDateString(value)
  const minDate = parseDateString(min)
  const maxDate = parseDateString(max)

  function handleSelect(date: Date | undefined) {
    if (!date) {
      onChange("")
      return
    }
    onChange(format(date, "yyyy-MM-dd"))
    setOpen(false)
  }

  function isDisabled(date: Date) {
    if (minDate && date < minDate) return true
    if (maxDate && date > maxDate) return true
    return false
  }

  const heightClass = size === "sm" ? "h-8" : "h-9"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            name={name}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn(
              "w-full justify-start gap-2 px-3 font-normal",
              heightClass,
              !selected && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
        <span className="truncate">
          {selected ? format(selected, displayFormat) : placeholder}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={handleSelect}
          disabled={minDate || maxDate ? isDisabled : undefined}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
