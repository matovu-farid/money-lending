"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { getCustomerAction } from "@/actions/customer.actions"
import { createLoanAction } from "@/actions/loan.actions"
import { calculateLoanSummary } from "@/lib/interest"
import type { CreateLoanInput, CollateralInput } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function formatUGX(amount: string): string {
  const num = parseFloat(amount)
  return new Intl.NumberFormat("en-UG", { style: "decimal", maximumFractionDigits: 2 }).format(num)
}

function todayISODate(): string {
  return new Date().toISOString().split("T")[0]
}

const COLLATERAL_NATURES = ["Land Title", "Vehicle Log Book", "Other"]

export default function NewLoanPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefilledCustomerId = searchParams.get("customerId") ?? ""

  const [step, setStep] = useState(1)

  // Step 1 — Loan Details
  const [customerId, setCustomerId] = useState(prefilledCustomerId)
  const [customerName, setCustomerName] = useState<string | null>(null)
  const [principalAmount, setPrincipalAmount] = useState("")
  const [startDate, setStartDate] = useState(todayISODate())
  const [interestRateDisplay, setInterestRateDisplay] = useState("10")

  // Step 2 — Collateral
  const [collateralNature, setCollateralNature] = useState("")
  const [collateralDescription, setCollateralDescription] = useState("")

  // Validation errors
  const [step1Errors, setStep1Errors] = useState<Record<string, string>>({})
  const [step2Errors, setStep2Errors] = useState<Record<string, string>>({})

  const [submitting, setSubmitting] = useState(false)

  // Fetch pre-filled customer name
  useEffect(() => {
    if (prefilledCustomerId) {
      getCustomerAction(prefilledCustomerId).then((result) => {
        if ("data" in result && result.data) {
          setCustomerName(result.data.fullName)
        }
      })
    }
  }, [prefilledCustomerId])

  // Interest preview (computed on render when at step 3)
  const loanSummary =
    step === 3 && principalAmount && interestRateDisplay
      ? calculateLoanSummary(
          principalAmount,
          (parseFloat(interestRateDisplay) / 100).toFixed(10),
          30
        )
      : null

  function validateStep1(): boolean {
    const errors: Record<string, string> = {}
    if (!customerId.trim()) errors.customerId = "Customer is required"
    if (!principalAmount.trim() || isNaN(parseFloat(principalAmount)) || parseFloat(principalAmount) <= 0) {
      errors.principalAmount = "Amount must be greater than 0"
    }
    if (!startDate.trim()) errors.startDate = "Start date is required"
    if (!interestRateDisplay.trim() || isNaN(parseFloat(interestRateDisplay)) || parseFloat(interestRateDisplay) <= 0) {
      errors.interestRate = "Interest rate must be greater than 0"
    }
    setStep1Errors(errors)
    return Object.keys(errors).length === 0
  }

  function validateStep2(): boolean {
    const errors: Record<string, string> = {}
    if (!collateralNature.trim()) errors.collateralNature = "Collateral nature is required"
    setStep2Errors(errors)
    return Object.keys(errors).length === 0
  }

  function handleStep1Next() {
    if (validateStep1()) setStep(2)
  }

  function handleStep2Next() {
    if (validateStep2()) setStep(3)
  }

  async function handleSubmit() {
    setSubmitting(true)

    const collateral: CollateralInput = {
      nature: collateralNature,
      description: collateralDescription.trim() || undefined,
    }

    const input: CreateLoanInput = {
      customerId,
      principalAmount,
      interestRate: (parseFloat(interestRateDisplay) / 100).toFixed(10),
      minInterestDays: 30,
      startDate: new Date(startDate).toISOString(),
      collateral,
    }

    const result = await createLoanAction(input)
    setSubmitting(false)

    if ("error" in result) {
      if (result.error === "Incomplete loan requirements" && "details" in result) {
        const details = result.details as { missing?: string[] }
        toast.error(`Missing fields: ${details.missing?.join(", ") ?? "unknown"}`)
      } else {
        toast.error(result.error)
      }
      return
    }

    toast.success("Loan issued successfully")
    router.push(`/customers/${customerId}`)
  }

  return (
    <div className="p-6 max-w-xl">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Issue New Loan</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Step {step} of 3
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {([1, 2, 3] as const).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium border ${
                step === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : step > s
                  ? "bg-primary/20 text-primary border-primary/30"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {s}
            </div>
            <span
              className={`text-sm ${
                step === s ? "font-medium" : "text-muted-foreground"
              }`}
            >
              {s === 1 ? "Loan Details" : s === 2 ? "Collateral" : "Review & Confirm"}
            </span>
            {s < 3 && <div className="w-6 h-px bg-border mx-1" />}
          </div>
        ))}
      </div>

      {/* Step 1: Loan Details */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Loan Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="customerId">Customer</Label>
              {prefilledCustomerId && customerName ? (
                <Input
                  id="customerId"
                  value={customerName}
                  disabled
                  className="bg-muted"
                />
              ) : (
                <Input
                  id="customerId"
                  type="text"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  placeholder="Customer ID"
                />
              )}
              {step1Errors.customerId && (
                <p className="text-destructive text-xs">{step1Errors.customerId}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="principalAmount">Amount (UGX)</Label>
              <Input
                id="principalAmount"
                type="number"
                min="0"
                value={principalAmount}
                onChange={(e) => setPrincipalAmount(e.target.value)}
                placeholder="e.g. 1000000"
              />
              {step1Errors.principalAmount && (
                <p className="text-destructive text-xs">{step1Errors.principalAmount}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              {step1Errors.startDate && (
                <p className="text-destructive text-xs">{step1Errors.startDate}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="interestRate">Interest Rate (% per month)</Label>
              <Input
                id="interestRate"
                type="number"
                min="0"
                step="0.1"
                value={interestRateDisplay}
                onChange={(e) => setInterestRateDisplay(e.target.value)}
                placeholder="10"
              />
              {step1Errors.interestRate && (
                <p className="text-destructive text-xs">{step1Errors.interestRate}</p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button onClick={handleStep1Next}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Collateral */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Collateral</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="collateralNature">Nature</Label>
              <Select
                value={collateralNature}
                onValueChange={(val: string | null) => setCollateralNature(val ?? "")}
              >
                <SelectTrigger id="collateralNature" className="w-full">
                  <SelectValue placeholder="Select collateral type" />
                </SelectTrigger>
                <SelectContent>
                  {COLLATERAL_NATURES.map((nature) => (
                    <SelectItem key={nature} value={nature}>
                      {nature}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {step2Errors.collateralNature && (
                <p className="text-destructive text-xs">{step2Errors.collateralNature}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="collateralDescription">Description (optional)</Label>
              <textarea
                id="collateralDescription"
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring min-h-[80px] resize-y"
                value={collateralDescription}
                onChange={(e) => setCollateralDescription(e.target.value)}
                placeholder="Additional details about the collateral..."
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={handleStep2Next}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Review & Confirm */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Review & Confirm</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Loan Summary */}
            <div>
              <h3 className="text-sm font-medium mb-3">Loan Details</h3>
              <dl className="space-y-2 text-sm">
                {customerName && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Customer</dt>
                    <dd className="font-medium">{customerName}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Principal Amount</dt>
                  <dd className="font-medium">UGX {formatUGX(principalAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Start Date</dt>
                  <dd className="font-medium">{startDate}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Interest Rate</dt>
                  <dd className="font-medium">{interestRateDisplay}% per month</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Collateral</dt>
                  <dd className="font-medium">{collateralNature}</dd>
                </div>
                {collateralDescription && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Collateral Description</dt>
                    <dd className="font-medium">{collateralDescription}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Interest Calculation Preview */}
            {loanSummary && (
              <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
                <h3 className="text-sm font-medium">Interest Calculation Preview</h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Daily interest amount</dt>
                    <dd className="font-medium">UGX {formatUGX(loanSummary.dailyInterest)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Total interest at minimum period</dt>
                    <dd className="font-medium">UGX {formatUGX(loanSummary.totalInterestAtMinPeriod)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 mt-2">
                    <dt className="font-medium">Total owed at minimum period</dt>
                    <dd className="font-semibold">UGX {formatUGX(loanSummary.totalOwedAtMinPeriod)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Minimum interest period applies even if repaid early ({loanSummary.minInterestDays} days minimum).
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                Back
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Issuing Loan..." : "Issue Loan"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
