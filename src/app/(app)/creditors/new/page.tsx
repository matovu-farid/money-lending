"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useSession } from "@/lib/auth-client"
import { createCreditorAction, addInvestmentAction } from "@/actions/creditor.actions"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MoneyInput } from "@/components/ui/money-input"
import { InfoPopover } from "@/components/ui/info-popover"
import { PermissionInfo } from "@/components/ui/permission-info"
import { cn, todayDateString } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import { ROLE_LEVELS, type UserRole } from "@/types"

interface CreditorFormValues {
  name: string
  contact: string
  address: string
  amount: string
  interestRateMonthly: string
  investmentDate: string
}

export default function NewCreditorPage() {
  const { data: session } = useSession()
  const actorRole = (session?.user?.role ?? "unassigned") as UserRole
  const isSupervisorOrAbove = ROLE_LEVELS[actorRole] >= ROLE_LEVELS.supervisor

  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<CreditorFormValues>({
    defaultValues: {
      name: "",
      contact: "",
      address: "",
      amount: "",
      interestRateMonthly: "10",
      investmentDate: todayDateString(),
    },
  })

  if (!isSupervisorOrAbove) {
    return (
      <div className="p-4 md:p-6 space-y-2">
        <div className="flex items-center gap-2">
          <PermissionInfo requiredRole="supervisor" action="Add creditors" locked />
          <p className="text-destructive font-medium">Access denied.</p>
        </div>
        <p className="text-muted-foreground text-sm">
          You need Supervisor or higher permissions to add creditors.
        </p>
      </div>
    )
  }

  function onSubmit(data: CreditorFormValues) {
    startTransition(async () => {
      try {
        const creditorResult = await createCreditorAction({
          name: data.name.trim(),
          contact: data.contact.trim(),
          address: data.address.trim(),
        })
        if ("error" in creditorResult) {
          toast.error(creditorResult.error)
          return
        }

        const investmentResult = await addInvestmentAction({
          creditorId: creditorResult.data.id,
          amount: data.amount.trim(),
          interestRateMonthly: (Number(data.interestRateMonthly) / 100).toString(),
          investmentDate: data.investmentDate,
        })
        if ("error" in investmentResult) {
          toast.error(investmentResult.error)
          return
        }

        router.push("/creditors")
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to register creditor")
      }
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <PageHeader
        title="Add Creditor"
        subtitle="Register a new creditor and record their initial investment."
        className="mb-6"
      />

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
                  maxLength={100}
                  disabled={isPending}
                  {...register("name", { required: "Name is required", validate: v => v.trim() !== "" || "Name is required" })}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="contact">Contact</Label>
                <Input
                  id="contact"
                  type="text"
                  placeholder="Phone number or email"
                  maxLength={100}
                  disabled={isPending}
                  {...register("contact", { required: "Contact is required", validate: v => v.trim() !== "" || "Contact is required" })}
                />
                {errors.contact && (
                  <p className="text-sm text-destructive">{errors.contact.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  type="text"
                  placeholder="e.g. Kampala, Uganda"
                  maxLength={200}
                  disabled={isPending}
                  {...register("address", { required: "Address is required", validate: v => v.trim() !== "" || "Address is required" })}
                />
                {errors.address && (
                  <p className="text-sm text-destructive">{errors.address.message}</p>
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
              <MoneyInput
                name="amount"
                control={control}
                label="Amount Invested"
                required="A valid investment amount is required"
                placeholder="e.g. 5,000,000"
                disabled={isPending}
                id="amount"
              />

              <div className="space-y-1">
                <Label htmlFor="interestRateMonthly" className="inline-flex items-center gap-1">
                  Monthly Interest Rate
                  <InfoPopover>
                    <p className="font-semibold text-sm mb-1">Creditor Interest Rate</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      The monthly rate you pay the creditor on their investment. This is a cost to your business.
                    </p>
                    <p className="text-xs text-muted-foreground mb-2">
                      This is different from the loan interest rate (what borrowers pay you). Your profit margin is the difference between the two.
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
                  <p className="text-sm text-destructive">{errors.interestRateMonthly.message}</p>
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
