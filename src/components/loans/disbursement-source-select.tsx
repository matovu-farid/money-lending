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
import type { UserRole } from "@/types"
import { ROLE_LEVELS } from "@/types"

interface DisbursementSourceSelectProps<T extends FieldValues> {
  name: Path<T>
  control: Control<T>
  /** Real-time balances per location (from getLocationBalancesAction) */
  locationBalances: Record<"cash" | "bank" | "strong_room", string> | null | undefined
  /** The amount being disbursed — used for insufficient-funds checks */
  amount: string
  disabled?: boolean
  id?: string
  userRole?: UserRole
}

function DisbursementSourceSelect<T extends FieldValues>({
  name,
  control,
  locationBalances,
  amount,
  disabled,
  id = "disbursementSource",
  userRole,
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
            if (!locationBalances || !amount) return true
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
          const canManageFunds = userRole && ROLE_LEVELS[userRole] >= ROLE_LEVELS.supervisor
          const selectedBalance = locationBalances ? new BigNumber(locationBalances[field.value as keyof typeof locationBalances] ?? "0") : null
          const isInsufficient = selectedBalance !== null && needed.isGreaterThan(0) && selectedBalance.isLessThan(needed)
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
                    const insufficient = balance !== null && needed.isGreaterThan(0) && balance.isLessThan(needed)
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
              {isInsufficient && !fieldState.error?.message && (
                <p className="text-sm text-destructive mt-1">
                  {canManageFunds
                    ? "Not enough funds at this source. Add funds via Fund Transfers before disbursing this loan."
                    : "Not enough funds at this source. Ask a supervisor to add funds before this loan can be disbursed."}
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
