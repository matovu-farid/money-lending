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

/** How many years back month/year dropdowns reach when no min is set. */
export const DATE_PICKER_YEARS_BACK = 100

export function parseDateString(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value + "T12:00:00")
  return isNaN(date.getTime()) ? undefined : date
}

function dayStartMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function getDatePickerMonthBounds(min?: string, max?: string) {
  const minDate = parseDateString(min)
  const maxDate = parseDateString(max)
  const now = new Date()

  return {
    minDate,
    maxDate,
    startMonth:
      minDate ?? new Date(now.getFullYear() - DATE_PICKER_YEARS_BACK, 0, 1),
    endMonth: maxDate ?? now,
  }
}

function isDateOutOfRange(
  date: Date,
  minDate: Date | undefined,
  maxDate: Date | undefined
) {
  const day = dayStartMs(date)
  if (minDate && day < dayStartMs(minDate)) return true
  if (maxDate && day > dayStartMs(maxDate)) return true
  return false
}

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
  /** Override the trigger label (e.g. show "Today" for the current date). */
  formatLabel?: (value: string, date: Date) => string
  "aria-label"?: string
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
  formatLabel,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = parseDateString(value)
  const { minDate, maxDate, startMonth, endMonth } = getDatePickerMonthBounds(
    min,
    max
  )
  const [month, setMonth] = React.useState<Date>(selected ?? endMonth)

  React.useEffect(() => {
    if (selected) {
      setMonth(selected)
    }
  }, [selected])

  React.useEffect(() => {
    if (!open) return
    setMonth(selected ?? endMonth)
  }, [open, selected, endMonth])

  function handleSelect(date: Date | undefined) {
    if (!date) {
      onChange("")
      return
    }
    onChange(format(date, "yyyy-MM-dd"))
    setOpen(false)
  }

  const heightClass = size === "sm" ? "h-8" : "h-9"
  const triggerLabel =
    selected && value
      ? (formatLabel?.(value, selected) ?? format(selected, displayFormat))
      : placeholder

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
        <span className="truncate">{triggerLabel}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          startMonth={startMonth}
          endMonth={endMonth}
          onSelect={handleSelect}
          disabled={
            minDate || maxDate
              ? (date) => isDateOutOfRange(date, minDate, maxDate)
              : undefined
          }
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
