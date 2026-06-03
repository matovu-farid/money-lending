"use client"

import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { toast } from "sonner"
import { creditorCollection } from "@/collections/creditors"
import { generateClientId } from "@/lib/client-id"
import { DrawerDialog, DrawerDialogContent } from "@/components/ui/drawer-dialog"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptTransaction, type TransactionReceiptData } from "@/components/receipts/pos-receipt-transaction"
import { getTransactionReceiptDataAction } from "@/actions/receipt.actions"
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/ui/money-input"
import { InfoPopover } from "@/components/ui/info-popover"
import { BankAccountSelect } from "@/components/ui/bank-account-select"
import { todayDateString } from "@/lib/utils"
import { PRINCIPAL_AMOUNT_PRESETS } from "@/lib/constants"

interface CreditorFormValues {
  name: string
  contact: string
  address: string
  amount: string
  interestRateMonthly: string
  investmentDate: string
  bankAccountId: string
}

interface AddCreditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddCreditorDialog({ open, onOpenChange }: AddCreditorDialogProps) {
  const [isPending, setIsPending] = useState(false)
  const [receipt, setReceipt] = useState<TransactionReceiptData | null>(null)

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CreditorFormValues>({
    defaultValues: {
      name: "",
      contact: "",
      address: "",
      amount: "",
      interestRateMonthly: "3",
      investmentDate: todayDateString(),
      bankAccountId: "",
    },
  })

  async function onSubmit(data: CreditorFormValues) {
    try {
      setIsPending(true)
      const id = generateClientId()
      const now = new Date()
      let createdInvestmentId: string | null = null

      const tx = creditorCollection.insert(
        {
          id,
          name: data.name.trim(),
          contact: data.contact.trim(),
          address: data.address.trim(),
          createdAt: now,
          updatedAt: now,
        },
        {
          metadata: {
            investment: {
              amount: data.amount.trim(),
              interestRateMonthly: (Number(data.interestRateMonthly) / 100).toString(),
              investmentDate: data.investmentDate,
              depositLocation: "bank",
              subLocationId: data.bankAccountId,
            },
            onInvestmentCreated: (investmentId: string) => {
              createdInvestmentId = investmentId
            },
          },
        }
      )
      await tx.isPersisted.promise

      toast.success("Creditor registered")
      onOpenChange(false)
      reset()

      if (createdInvestmentId) {
        const result = await getTransactionReceiptDataAction({
          kind: "creditor_investment",
          investmentId: createdInvestmentId,
        })
        if ("data" in result) {
          setReceipt(result.data)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to register creditor"
      console.error("[AddCreditorDialog] register failed", err)
      toast.error(msg)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <>
    <DrawerDialog open={open} onOpenChange={onOpenChange}>
      <DrawerDialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Creditor</DialogTitle>
          <DialogDescription>
            Register a new creditor and record their initial investment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4" id="add-creditor-form">
          {/* Creditor Information */}
          <div className="space-y-1">
            <Label htmlFor="cred-name">Name</Label>
            <Input
              id="cred-name"
              type="text"
              placeholder="e.g. John Investor"
              maxLength={100}
              disabled={isPending}
              {...register("name", { required: "Name is required", validate: v => v.trim() !== "" || "Name is required" })}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cred-contact">Contact</Label>
            <Input
              id="cred-contact"
              type="text"
              placeholder="Phone number or email"
              maxLength={100}
              disabled={isPending}
              {...register("contact", { required: "Contact is required", validate: v => v.trim() !== "" || "Contact is required" })}
            />
            {errors.contact && <p className="text-sm text-destructive">{errors.contact.message}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cred-address">Address</Label>
            <Input
              id="cred-address"
              type="text"
              placeholder="e.g. Kampala, Uganda"
              maxLength={200}
              disabled={isPending}
              {...register("address", { required: "Address is required", validate: v => v.trim() !== "" || "Address is required" })}
            />
            {errors.address && <p className="text-sm text-destructive">{errors.address.message}</p>}
          </div>

          {/* Initial Investment */}
          <div className="border-t pt-4 mt-4">
            <p className="text-sm font-medium mb-3">Initial Investment</p>
            <div className="space-y-4">
              <MoneyInput
                name="amount"
                control={control}
                label="Amount Invested"
                required="A valid investment amount is required"
                placeholder="e.g. 5,000,000"
                disabled={isPending}
                id="cred-amount"
                presets={PRINCIPAL_AMOUNT_PRESETS}
              />

              <div className="space-y-1">
                <Label htmlFor="cred-rate" className="inline-flex items-center gap-1">
                  Monthly Interest Rate
                  <InfoPopover>
                    <p className="font-semibold text-sm mb-1">Creditor Interest Rate</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      The monthly rate you pay the creditor on their investment. This is a cost to your business.
                    </p>
                    <div className="bg-muted/50 rounded-md p-2 text-xs space-y-1">
                      <p className="font-medium">Example:</p>
                      <p>Creditor rate: 5%/month (you pay them)</p>
                      <p>Loan rate: 10%/month (borrowers pay you)</p>
                      <p>Margin: 5%/month on deployed capital</p>
                    </div>
                  </InfoPopover>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="cred-rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    disabled={isPending}
                    className="flex-1"
                    {...register("interestRateMonthly", {
                      required: "Interest rate is required",
                      validate: v => !isNaN(Number(v)) || "Interest rate is required",
                    })}
                  />
                  <span className="text-sm text-muted-foreground font-medium w-6 shrink-0">%</span>
                </div>
                {errors.interestRateMonthly && (
                  <p className="text-sm text-destructive">{errors.interestRateMonthly.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="cred-date">Date</Label>
                <Controller
                  name="investmentDate"
                  control={control}
                  rules={{ required: "Date is required" }}
                  render={({ field }) => (
                    <DatePicker
                      id="cred-date"
                      value={field.value}
                      onChange={field.onChange}
                      disabled={isPending}
                    />
                  )}
                />
                {errors.investmentDate && <p className="text-sm text-destructive">{errors.investmentDate.message}</p>}
              </div>

              <BankAccountSelect
                name="bankAccountId"
                control={control}
                label="Deposit To"
                disabled={isPending}
                id="cred-bank-account"
                showBalances={false}
              />
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button type="submit" form="add-creditor-form" disabled={isPending}>
            Register Creditor
          </Button>
        </DialogFooter>
      </DrawerDialogContent>
    </DrawerDialog>

    <PosReceiptModal
      open={receipt !== null}
      onClose={() => setReceipt(null)}
      title="Creditor Investment Receipt"
      autoActions
    >
      {receipt && <PosReceiptTransaction data={receipt} />}
    </PosReceiptModal>
    </>
  )
}
