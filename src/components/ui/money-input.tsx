"use client"

import * as React from "react"
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form"
import { Input } from "@/components/ui/input"
import { cn, formatNumberWithCommas } from "@/lib/utils"

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

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9.]/g, "")
    field.onChange(raw)
  }

  const inputId = id ?? name

  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium leading-none">
          {label}
        </label>
      )}
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
          onChange={handleChange}
          onBlur={field.onBlur}
          ref={field.ref}
          name={field.name}
        />
      </div>
      {fieldState.error?.message && (
        <p className="text-sm text-destructive">{fieldState.error.message}</p>
      )}
    </div>
  )
}

export { MoneyInput, type MoneyInputProps }
