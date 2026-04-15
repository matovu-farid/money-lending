"use client"

import { Controller, type Control, type FieldValues, type Path } from "react-hook-form"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DEPOSIT_LOCATION_OPTIONS } from "@/lib/constants"
import { BankAccountSelect } from "./bank-account-select"

interface DepositLocationSelectProps<T extends FieldValues> {
  name: Path<T>
  control: Control<T>
  label?: string
  disabled?: boolean
  id?: string
  subLocationName?: Path<T>
  bankAccountBalances?: Record<string, string>
}

/**
 * Shared deposit-location selector for money-in flows (payments, expenses, income).
 * For money-out (loan disbursement) with balance checks, use DisbursementSourceSelect instead.
 */
function DepositLocationSelect<T extends FieldValues>({
  name,
  control,
  label = "Source Location",
  disabled,
  id = "deposit-location",
  subLocationName,
  bankAccountBalances,
}: DepositLocationSelectProps<T>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        name={name}
        control={control}
        rules={{ required: "Deposit location is required" }}
        render={({ field, fieldState }) => (
          <>
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={disabled}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {DEPOSIT_LOCATION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldState.error?.message && (
              <p className="text-sm text-destructive">{fieldState.error.message}</p>
            )}
            {field.value === "bank" && subLocationName && (
              <BankAccountSelect
                name={subLocationName}
                control={control}
                disabled={disabled}
                bankAccountBalances={bankAccountBalances}
              />
            )}
          </>
        )}
      />
    </div>
  )
}

export { DepositLocationSelect, type DepositLocationSelectProps }
