"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { createCreditorAction, addInvestmentAction } from "@/app/(app)/creditors/actions"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn, formatNumberWithCommas, stripCommas } from "@/lib/utils"

interface CreditorFormValues {
  name: string
  contact: string
  address: string
  amount: string
  interestRateMonthly: string
  investmentDate: string
}

export default function NewCreditorPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreditorFormValues>({
    defaultValues: {
      name: "",
      contact: "",
      address: "",
      amount: "",
      interestRateMonthly: "10",
      investmentDate: new Date().toISOString().split("T")[0],
    },
  })

  const watchedAmount = watch("amount")

  function onSubmit(data: CreditorFormValues) {
    startTransition(async () => {
      try {
        const creditor = await createCreditorAction({
          name: data.name.trim(),
          contact: data.contact.trim(),
          address: data.address.trim(),
        })

        await addInvestmentAction({
          creditorId: creditor.id,
          amount: data.amount.trim(),
          interestRateMonthly: (Number(data.interestRateMonthly) / 100).toString(),
          investmentDate: data.investmentDate,
        })

        router.push("/creditors")
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to register creditor")
      }
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Add Creditor</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Register a new creditor and record their initial investment.
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Creditor Information</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" id="creditor-form">
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="e.g. John Investor"
                  disabled={isPending}
                  {...register("name", { required: "Name is required", validate: v => v.trim() !== "" || "Name is required" })}
                />
                {errors.name && (
                  <p className="text-destructive text-xs">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="contact">Contact</Label>
                <Input
                  id="contact"
                  type="text"
                  placeholder="Phone number or email"
                  disabled={isPending}
                  {...register("contact", { required: "Contact is required", validate: v => v.trim() !== "" || "Contact is required" })}
                />
                {errors.contact && (
                  <p className="text-destructive text-xs">{errors.contact.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  type="text"
                  placeholder="e.g. Kampala, Uganda"
                  disabled={isPending}
                  {...register("address", { required: "Address is required", validate: v => v.trim() !== "" || "Address is required" })}
                />
                {errors.address && (
                  <p className="text-destructive text-xs">{errors.address.message}</p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Initial Investment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="amount">Amount Invested</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground font-medium w-10 shrink-0">UGX</span>
                  <Input
                    id="amount"
                    type="text"
                    inputMode="numeric"
                    form="creditor-form"
                    value={formatNumberWithCommas(watchedAmount)}
                    onChange={(e) => {
                      const raw = stripCommas(e.target.value).replace(/[^0-9.]/g, "")
                      setValue("amount", raw, { shouldValidate: true })
                    }}
                    placeholder="e.g. 5,000,000"
                    disabled={isPending}
                    className="flex-1"
                  />
                  <input
                    type="hidden"
                    form="creditor-form"
                    {...register("amount", {
                      required: "A valid investment amount is required",
                      validate: v => {
                        const n = Number(v)
                        if (isNaN(n) || n <= 0) return "A valid investment amount is required"
                        return true
                      },
                    })}
                  />
                </div>
                {errors.amount && (
                  <p className="text-destructive text-xs">{errors.amount.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="interestRateMonthly">Monthly Interest Rate</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="interestRateMonthly"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    form="creditor-form"
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
                  <p className="text-destructive text-xs">{errors.interestRateMonthly.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="investmentDate">Date</Label>
                <Input
                  id="investmentDate"
                  type="date"
                  form="creditor-form"
                  disabled={isPending}
                  {...register("investmentDate", { required: "Date is required" })}
                />
                {errors.investmentDate && <p className="text-sm text-destructive">{errors.investmentDate.message}</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" form="creditor-form" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                Registering...
              </>
            ) : (
              "Register Creditor"
            )}
          </Button>
          <Link
            href="/creditors"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  )
}
