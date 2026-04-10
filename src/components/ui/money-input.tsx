"use client"

import { useState } from "react"
import {
  useController,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form"
import { Check } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn, formatNumberWithCommas } from "@/lib/utils"

interface Preset {
  label: string
  value: string
}

interface Suggestion {
  label: string
  value: string
  description?: string
}

interface MoneyInputProps<T extends FieldValues> {
  name: Path<T>
  control: Control<T>
  label?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean | string
  min?: number
  id?: string
  className?: string
  presets?: readonly Preset[]
  suggestions?: readonly Suggestion[]
}

function MoneyInput<T extends FieldValues>({
  name,
  control,
  label,
  placeholder = "e.g. 1,000,000",
  disabled,
  required,
  min,
  id,
  className,
  presets,
  suggestions,
}: MoneyInputProps<T>) {
  const requiredMessage =
    typeof required === "string" ? required : required ? "This field is required" : undefined

  const { field, fieldState } = useController({
    name,
    control,
    rules: {
      required: requiredMessage,
      validate: (value) => {
        if (!required && (!value || value === "")) return true
        const num = Number(String(value))
        if (isNaN(num)) return "Must be a valid number"
        if (min != null && num < min) return `Must be at least ${formatNumberWithCommas(String(min))}`
        if (required && num <= 0) return "Amount must be greater than 0"
        return true
      },
    },
  })

  const currentValue = useWatch({ control, name })
  const [open, setOpen] = useState(false)
  const hasSuggestions = suggestions && suggestions.length > 0

  const inputId = id ?? name

  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-semibold leading-none">
          {label}
        </label>
      )}
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground font-medium w-10 shrink-0">UGX</span>
          <Input
            id={inputId}
            type="text"
            inputMode="numeric"
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1"
            value={formatNumberWithCommas(String(field.value ?? ""))}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9]/g, "").replace(/^0+/, "") || ""
              field.onChange(raw)
            }}
            onFocus={() => hasSuggestions && setOpen(true)}
            onBlur={() => {
              setTimeout(() => setOpen(false), 150)
              field.onBlur()
            }}
            ref={field.ref}
            name={field.name}
          />
        </div>

        {hasSuggestions && open && !disabled && (
          <div
            className="absolute left-10 right-0 z-50 mt-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
            onMouseDown={(e) => e.preventDefault()}
          >
            <ul className="py-1" role="listbox" aria-label="Suggested amounts">
              {suggestions.map((s) => {
                const selected = String(currentValue) === s.value
                return (
                  <li key={s.value} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-muted",
                        selected && "bg-muted"
                      )}
                      onClick={() => { field.onChange(s.value); setOpen(false) }}
                    >
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="font-medium">{s.label}</span>
                        {s.description && (
                          <span className="text-xs text-muted-foreground">{s.description}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono tabular-nums text-muted-foreground">
                          UGX {formatNumberWithCommas(s.value)}
                        </span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
      {fieldState.error?.message && (
        <p className="text-sm text-destructive">{fieldState.error.message}</p>
      )}
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {presets.map((p) => (
            <Button
              key={p.value}
              type="button"
              variant={String(currentValue) === p.value ? "default" : "outline"}
              size="sm"
              className="rounded-full text-xs px-3 h-7"
              disabled={disabled}
              onClick={() => field.onChange(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export { MoneyInput, type MoneyInputProps, type Preset as MoneyPreset, type Suggestion as MoneySuggestion }
