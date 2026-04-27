"use client"

import { useEffect } from "react"
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form"
import { useLiveQuery } from "@tanstack/react-db"
import BigNumber from "bignumber.js"
import Link from "next/link"
import { bankAccountCollection } from "@/collections/bank-accounts"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency } from "@/lib/utils"

interface BankAccountSelectProps<T extends FieldValues> {
  name: Path<T>
  control: Control<T>
  label?: string
  disabled?: boolean
  id?: string
  bankAccountBalances?: Record<string, string>
  showBalances?: boolean
  /** When set, accounts with balance < requiredAmount are disabled and the field
   * fails validation if the selected account cannot cover this amount. */
  requiredAmount?: string
}

function BankAccountSelect<T extends FieldValues>({
  name,
  control,
  label = "Bank Account",
  disabled,
  id = "bank-account",
  bankAccountBalances,
  showBalances = true,
  requiredAmount,
}: BankAccountSelectProps<T>) {
  const needed = requiredAmount ? new BigNumber(requiredAmount) : null
  const { data: allAccounts } = useLiveQuery((q) =>
    q.from({ ba: bankAccountCollection }).select(({ ba }) => ba)
  )
  const activeAccounts = (allAccounts ?? []).filter((a) => a.isActive)

  if (activeAccounts.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <p className="text-sm text-muted-foreground">
          No bank accounts have been set up yet. Please{" "}
          <Link href="/fund-transfers" className="text-primary underline underline-offset-4 hover:text-primary/80">
            add a bank account
          </Link>{" "}
          first before proceeding.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        name={name}
        control={control}
        rules={{
          required: "Bank account is required",
          validate: (v) => {
            if (!v || !needed || !needed.isGreaterThan(0) || !bankAccountBalances) return true
            const balance = new BigNumber(bankAccountBalances[v as string] ?? "0")
            if (balance.isLessThan(needed)) {
              return "Insufficient funds in this bank account"
            }
            return true
          },
        }}
        render={({ field, fieldState }) => (
          <>
            <AutoSelectSingle
              value={field.value as string | undefined}
              onChange={field.onChange}
              onlyAccountId={activeAccounts.length === 1 ? activeAccounts[0].id : null}
            />
            <Select
              value={field.value ?? ""}
              onValueChange={field.onChange}
              disabled={disabled}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder="Select bank account">
                  {(value) => {
                    if (!value) return "Select bank account"
                    const account = activeAccounts.find((a) => a.id === value)
                    return account?.name ?? "Select bank account"
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((account) => {
                  const balance = bankAccountBalances?.[account.id]
                  const balanceBn = balance != null ? new BigNumber(balance) : null
                  const insufficient =
                    needed !== null &&
                    needed.isGreaterThan(0) &&
                    balanceBn !== null &&
                    balanceBn.isLessThan(needed)
                  return (
                    <SelectItem key={account.id} value={account.id} disabled={insufficient}>
                      {account.name}
                      {showBalances && balance != null && (
                        <span className="text-muted-foreground ml-2">
                          — {formatCurrency(balance)}
                        </span>
                      )}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {fieldState.error?.message && (
              <p className="text-sm text-destructive">{fieldState.error.message}</p>
            )}
            {!fieldState.error?.message && (() => {
              if (!needed || !needed.isGreaterThan(0) || !field.value) return null
              const balance = new BigNumber(bankAccountBalances?.[field.value as string] ?? "0")
              if (balance.isLessThan(needed)) {
                return (
                  <p className="text-sm text-destructive">
                    Insufficient funds in this bank account.
                  </p>
                )
              }
              return null
            })()}
          </>
        )}
      />
    </div>
  )
}

function AutoSelectSingle({
  value,
  onChange,
  onlyAccountId,
}: {
  value: string | undefined
  onChange: (v: string) => void
  onlyAccountId: string | null
}) {
  useEffect(() => {
    if (onlyAccountId && !value) onChange(onlyAccountId)
  }, [onlyAccountId, value, onChange])
  return null
}

export { BankAccountSelect, type BankAccountSelectProps }
