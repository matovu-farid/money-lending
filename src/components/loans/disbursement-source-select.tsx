"use client"

import { Controller, type Control, type FieldValues, type Path } from "react-hook-form"
import BigNumber from "bignumber.js"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { DEPOSIT_LOCATION_OPTIONS } from "@/lib/constants"

interface DisbursementSourceSelectProps<T extends FieldValues> {
  name: Path<T>
  control: Control<T>
  /** Real-time balances per location (from getLocationBalancesAction) */
  locationBalances: Record<"cash" | "bank" | "strong_room", string> | null | undefined
  /** The amount being disbursed — used for insufficient-funds checks */
  amount: string
  disabled?: boolean
  id?: string
}

function DisbursementSourceSelect<T extends FieldValues>({
  name,
  control,
  locationBalances,
  amount,
  disabled,
  id = "disbursementSource",
}: DisbursementSourceSelectProps<T>) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="font-semibold">Disbursement Source</Label>
      <Controller
        name={name}
        control={control}
        rules={{
          required: "Disbursement source is required",
          validate: (v) => {
            if (v === "cash" || !locationBalances || !amount) return true
            const available = new BigNumber(locationBalances[v as keyof typeof locationBalances] ?? "0")
            const needed = new BigNumber(amount || "0")
            if (needed.isGreaterThan(0) && available.isLessThan(needed)) {
              return "Insufficient funds at this source"
            }
            return true
          },
        }}
        render={({ field, fieldState }) => {
          const needed = new BigNumber(amount || "0")
          const cashBalance = locationBalances ? new BigNumber(locationBalances.cash ?? "0") : null
          const cashShortfall = cashBalance !== null && needed.isGreaterThan(0) && cashBalance.isLessThan(needed)
          return (
            <>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={disabled}
              >
                <SelectTrigger id={id} className="min-w-[10rem]">
                  {DEPOSIT_LOCATION_OPTIONS.find((o) => o.value === field.value)?.label ?? "Select source"}
                </SelectTrigger>
                <SelectContent>
                  {DEPOSIT_LOCATION_OPTIONS.map((opt) => {
                    const balance = locationBalances ? new BigNumber(locationBalances[opt.value] ?? "0") : null
                    const insufficient = opt.value !== "cash" && balance !== null && needed.isGreaterThan(0) && balance.isLessThan(needed)
                    return (
                      <SelectItem key={opt.value} value={opt.value} disabled={insufficient}>
                        {opt.label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              {fieldState.error?.message && (
                <p className="text-sm text-destructive">{fieldState.error.message}</p>
              )}
              {field.value === "cash" && cashShortfall && (
                <p className="text-xs text-muted-foreground mt-1">
                  Cash on hand is below the disbursement amount. The difference will be added as a capital injection automatically.
                </p>
              )}
            </>
          )
        }}
      />
    </div>
  )
}

export { DisbursementSourceSelect, type DisbursementSourceSelectProps }
