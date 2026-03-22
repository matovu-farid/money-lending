"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { createCreditorAction, addInvestmentAction } from "@/app/(app)/creditors/actions"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export default function NewCreditorPage() {
  const router = useRouter()

  // Creditor fields
  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [address, setAddress] = useState("")

  // Investment fields
  const [amount, setAmount] = useState("")
  const [interestRateMonthly, setInterestRateMonthly] = useState("10")
  const [investmentDate, setInvestmentDate] = useState(
    () => new Date().toISOString().split("T")[0]
  )

  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = "Name is required"
    if (!contact.trim()) errors.contact = "Contact is required"
    if (!address.trim()) errors.address = "Address is required"
    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0) {
      errors.amount = "A valid investment amount is required"
    }
    if (!interestRateMonthly.trim() || isNaN(Number(interestRateMonthly))) {
      errors.interestRateMonthly = "Interest rate is required"
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setFieldErrors({})
    setSubmitting(true)

    try {
      const creditor = await createCreditorAction({
        name: name.trim(),
        contact: contact.trim(),
        address: address.trim(),
      })

      await addInvestmentAction({
        creditorId: creditor.id,
        amount: amount.trim(),
        interestRateMonthly: (Number(interestRateMonthly) / 100).toString(),
        investmentDate,
      })

      window.location.href = "/creditors"
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to register creditor")
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-lg">
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
            <form onSubmit={handleSubmit} className="space-y-4" id="creditor-form">
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. John Investor"
                  disabled={submitting}
                />
                {fieldErrors.name && (
                  <p className="text-destructive text-xs">{fieldErrors.name}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="contact">Contact</Label>
                <Input
                  id="contact"
                  name="contact"
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Phone number or email"
                  disabled={submitting}
                />
                {fieldErrors.contact && (
                  <p className="text-destructive text-xs">{fieldErrors.contact}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  name="address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Kampala, Uganda"
                  disabled={submitting}
                />
                {fieldErrors.address && (
                  <p className="text-destructive text-xs">{fieldErrors.address}</p>
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
                    name="amount"
                    type="number"
                    min="1"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 5000000"
                    disabled={submitting}
                    className="flex-1"
                  />
                </div>
                {fieldErrors.amount && (
                  <p className="text-destructive text-xs">{fieldErrors.amount}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="interestRateMonthly">Monthly Interest Rate</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="interestRateMonthly"
                    name="interestRateMonthly"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={interestRateMonthly}
                    onChange={(e) => setInterestRateMonthly(e.target.value)}
                    disabled={submitting}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground font-medium w-6 shrink-0">%</span>
                </div>
                {fieldErrors.interestRateMonthly && (
                  <p className="text-destructive text-xs">{fieldErrors.interestRateMonthly}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="investmentDate">Date</Label>
                <Input
                  id="investmentDate"
                  name="investmentDate"
                  type="date"
                  value={investmentDate}
                  onChange={(e) => setInvestmentDate(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" form="creditor-form" disabled={submitting}>
            {submitting ? "Saving..." : "Add Creditor"}
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
