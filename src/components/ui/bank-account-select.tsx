"use client"

import { Controller, type Control, type FieldValues, type Path } from "react-hook-form"
import { useLiveQuery } from "@tanstack/react-db"
import Link from "next/link"
import { bankAccountCollection } from "@/collections"
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
}

function BankAccountSelect<T extends FieldValues>({
  name,
  control,
  label = "Bank Account",
  disabled,
  id = "bank-account",
  bankAccountBalances,
  showBalances = true,
}: BankAccountSelectProps<T>) {
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
        rules={{ required: "Bank account is required" }}
        render={({ field, fieldState }) => (
          <>
            <Select
              value={field.value ?? ""}
              onValueChange={field.onChange}
              disabled={disabled}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder="Select bank account" />
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((account) => {
                  const balance = bankAccountBalances?.[account.id]
                  return (
                    <SelectItem key={account.id} value={account.id}>
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
          </>
        )}
      />
    </div>
  )
}

export { BankAccountSelect, type BankAccountSelectProps }
