"use client"

import { Suspense, useRef, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm, Controller } from "react-hook-form"
import { Loader2 } from "lucide-react"
import { getCustomerAction } from "@/actions/customer.actions"
import { getCollateralNaturesAction } from "@/actions/loan.actions"
import { checkCustomerActiveLoanAction } from "@/actions/settlement.actions"
import { useCreateLoan } from "@/hooks/use-create-loan"
import { useSession } from "@/lib/auth-client"
import { queryKeys } from "@/hooks/query-keys"
import { calculateLoanSummary } from "@/lib/interest"
import { generateReceiptNumber } from "@/lib/receipt-number"
import type { CollateralInput, LoanType } from "@/types"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MoneyInput } from "@/components/ui/money-input"
import { formatDate, formatCurrency } from "@/lib/utils"
import { RolloverBanner } from "@/components/loans/rollover-banner"
import { PageHeader } from "@/components/ui/page-header"
import BigNumber from "bignumber.js"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptDisbursement } from "@/components/receipts/pos-receipt-disbursement"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function todayISODate(): string {
  return new Date().toISOString().split("T")[0]
}

interface LoanFormValues {
  customerId: string
  principalAmount: string
  issuanceFee: string
  description: string
  startDate: string
  interestRateDisplay: string
  disbursementSource: "cash" | "bank" | "strong_room"
  collateralNature: string
  collateralDescription: string
}

interface ReceiptData {
  receiptNumber: string
  customerId: string
  customerName: string
  loanAmount: string
  issuanceFee: string
  description: string
  interestRate: string
  collateralNature: string
  collateralDescription?: string
  disbursementSource: string
  date: string
}

function NewLoanPageInner() {
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const router = useRouter()
  const createLoan = useCreateLoan()
  const { data: session } = useSession()
  const prefilledCustomerId = searchParams.get("customerId") ?? ""

  const [step, setStep] = useState(1)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [loanType, setLoanType] = useState<LoanType>("perpetual")
  const [termMonths, setTermMonths] = useState<string>("")

  const {
    register,
    watch,
    setValue,
    trigger,
    control,
    handleSubmit: rhfHandleSubmit,
    formState: { errors },
  } = useForm<LoanFormValues>({
    defaultValues: {
      customerId: prefilledCustomerId,
      principalAmount: "",
      issuanceFee: "",
      description: "",
      startDate: todayISODate(),
      interestRateDisplay: "10",
      disbursementSource: "cash",
      collateralNature: "",
      collateralDescription: "",
    },
    mode: "onTouched",
  })

  // Watch values for computed fields and display
  const customerId = watch("customerId")
  const principalAmount = watch("principalAmount")
  const startDate = watch("startDate")
  const interestRateDisplay = watch("interestRateDisplay")
  const collateralNature = watch("collateralNature")
  const collateralDescription = watch("collateralDescription")
  const issuanceFee = watch("issuanceFee")
  const description = watch("description")
  const disbursementSource = watch("disbursementSource")

  // Collateral autocomplete state (UI-only, not form fields)
  const [showNatureSuggestions, setShowNatureSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const natureInputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLUListElement>(null)

  const isPending = createLoan.isPending

  // Fetch known collateral natures for autocomplete
  const { data: knownNatures = [] } = useQuery({
    queryKey: ["collateral-natures"],
    queryFn: getCollateralNaturesAction,
  })

  const filteredNatures = collateralNature.trim()
    ? knownNatures.filter((n) =>
        n.toLowerCase().includes(collateralNature.toLowerCase())
      )
    : knownNatures

  // Resolve pre-filled customer name from cache or fetch
  const cachedCustomer = prefilledCustomerId
    ? queryClient.getQueryData<{ fullName: string }>(queryKeys.customers.detail(prefilledCustomerId))
    : undefined
  const { data: customerName = null } = useQuery({
    queryKey: queryKeys.customers.detail(prefilledCustomerId),
    queryFn: async () => {
      const result = await getCustomerAction(prefilledCustomerId)
      if ("data" in result && result.data) {
        return result.data
      }
      return null
    },
    enabled: !!prefilledCustomerId,
    initialData: cachedCustomer,
    select: (data) => data?.fullName ?? null,
  })

  // Check if customer has an active loan (for rollover)
  const { data: activeLoanData } = useQuery({
    queryKey: ["active-loan-check", customerId],
    queryFn: async () => {
      const result = await checkCustomerActiveLoanAction(customerId)
      if ("error" in result || !result.data) return null
      return result.data
    },
    enabled: !!customerId && customerId.length > 0,
  })

  // Interest preview (computed on render when at step 3)
  const loanSummary =
    step === 3 && principalAmount && interestRateDisplay
      ? calculateLoanSummary(
          principalAmount,
          (parseFloat(interestRateDisplay) / 100).toFixed(10),
          loanType === "perpetual" ? 30 : undefined,
          loanType !== "perpetual" ? loanType : undefined,
          loanType !== "perpetual" ? parseInt(termMonths, 10) : undefined
        )
      : null

  // Step-level validation fields
  const step1Fields: (keyof LoanFormValues)[] = ["customerId", "principalAmount", "issuanceFee", "description", "startDate", "interestRateDisplay", "disbursementSource"]
  const step2Fields: (keyof LoanFormValues)[] = ["collateralNature"]

  async function handleStep1Next() {
    const valid = await trigger(step1Fields)
    if (!valid) return
    if (loanType !== "perpetual" && (!termMonths || parseInt(termMonths, 10) <= 0)) {
      toast.error("Term months is required for fixed rate and reducing balance loans")
      return
    }
    setStep(2)
  }

  async function handleStep2Next() {
    const valid = await trigger(step2Fields)
    if (valid) setStep(3)
  }

  function onSubmit(data: LoanFormValues) {
    const collateral: CollateralInput = {
      nature: data.collateralNature,
      description: data.collateralDescription.trim() || undefined,
    }

    const rolloverData = activeLoanData
      ? {
          fromLoanId: activeLoanData.loan.id,
          carriedPrincipal: activeLoanData.outstandingPrincipal,
          carriedInterest: activeLoanData.accruedInterest,
        }
      : undefined

    createLoan.mutate(
      {
        customerId: data.customerId,
        principalAmount: data.principalAmount,
        issuanceFee: data.issuanceFee,
        description: data.description.trim(),
        interestRate: (parseFloat(data.interestRateDisplay) / 100).toFixed(10),
        minInterestDays: 30,
        startDate: new Date(data.startDate).toISOString(),
        collateral,
        disbursementSource: data.disbursementSource,
        loanType,
        termMonths: loanType !== "perpetual" ? parseInt(termMonths, 10) : undefined,
        rollover: rolloverData,
      },
      {
        onSuccess: (result) => {
          if (!("error" in result)) {
            setReceiptData({
              receiptNumber: generateReceiptNumber(),
              customerId: data.customerId,
              customerName: customerName ?? "Customer",
              loanAmount: data.principalAmount,
              issuanceFee: data.issuanceFee,
              description: data.description.trim(),
              interestRate: `${data.interestRateDisplay}%`,
              collateralNature: data.collateralNature,
              collateralDescription: data.collateralDescription.trim() || undefined,
              disbursementSource: data.disbursementSource,
              date: new Date(data.startDate).toISOString(),
            })
          }
        },
      }
    )
  }

  // Merge the react-hook-form register ref with our local ref for the collateral nature input
  const { ref: rhfNatureRef, ...collateralNatureRegistration } = register("collateralNature", {
    required: "Collateral nature is required",
  })

  return (
    <div className="p-4 md:p-6 max-w-xl">
      <PageHeader
        title="Issue New Loan"
        subtitle={`Step ${step} of 3`}
        className="mb-4"
      />

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

      <form onSubmit={rhfHandleSubmit(onSubmit)}>
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
                    placeholder="Customer ID"
                    {...register("customerId", {
                      required: "Customer is required",
                    })}
                  />
                )}
                {errors.customerId && (
                  <p className="text-sm text-destructive">{errors.customerId.message}</p>
                )}
              </div>

              {activeLoanData && (
                <RolloverBanner
                  loanId={activeLoanData.loan.id}
                  customerName={activeLoanData.customerName}
                  outstandingPrincipal={activeLoanData.outstandingPrincipal}
                  accruedInterest={activeLoanData.accruedInterest}
                />
              )}

              <div className="space-y-2">
                <Label>Loan Type</Label>
                <div className="flex gap-4">
                  {[
                    { value: "perpetual" as const, label: "Perpetual" },
                    { value: "fixed_rate" as const, label: "Fixed Rate" },
                    { value: "reducing_balance" as const, label: "Reducing Balance" },
                  ].map((option) => (
                    <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="loanType"
                        value={option.value}
                        checked={loanType === option.value}
                        onChange={(e) => setLoanType(e.target.value as LoanType)}
                        className="accent-primary"
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {loanType !== "perpetual" && (
                <div className="space-y-2">
                  <Label htmlFor="termMonths">Term (months)</Label>
                  <Input
                    id="termMonths"
                    type="number"
                    min="1"
                    step="1"
                    value={termMonths}
                    onChange={(e) => setTermMonths(e.target.value)}
                    placeholder="e.g. 6"
                  />
                </div>
              )}

              <MoneyInput
                name="principalAmount"
                control={control}
                label="Amount (UGX)"
                required="Amount is required"
                id="principalAmount"
              />

              <MoneyInput
                name="issuanceFee"
                control={control}
                label="Issuance Fee (UGX)"
                required="Issuance fee is required"
                id="issuanceFee"
                min={50000}
              />

              <div className="space-y-1">
                <Label htmlFor="description">Loan Description / Purpose</Label>
                <textarea
                  id="description"
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring min-h-[80px] resize-y"
                  placeholder="Describe the purpose of this loan..."
                  {...register("description", {
                    required: "Loan description is required",
                  })}
                />
                {errors.description && (
                  <p className="text-sm text-destructive">{errors.description.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  {...register("startDate", {
                    required: "Start date is required",
                  })}
                />
                {errors.startDate && (
                  <p className="text-sm text-destructive">{errors.startDate.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="interestRate">Interest Rate (% per month)</Label>
                <Input
                  id="interestRate"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="10"
                  {...register("interestRateDisplay", {
                    required: "Interest rate is required",
                    validate: (v) => {
                      const n = parseFloat(v)
                      if (isNaN(n) || n <= 0) return "Interest rate must be greater than 0"
                      return true
                    },
                  })}
                />
                {errors.interestRateDisplay && (
                  <p className="text-sm text-destructive">{errors.interestRateDisplay.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="disbursementSource">Disbursement Source</Label>
                <Controller
                  name="disbursementSource"
                  control={control}
                  rules={{ required: "Disbursement source is required" }}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger id="disbursementSource">
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="strong_room">Strong Room</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.disbursementSource && (
                  <p className="text-sm text-destructive">{errors.disbursementSource.message}</p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" onClick={handleStep1Next}>Next</Button>
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
              <div className="space-y-1 relative">
                <Label htmlFor="collateralNature">Nature</Label>
                <Input
                  id="collateralNature"
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. Land Title, Vehicle Log Book"
                  role="combobox"
                  aria-expanded={showNatureSuggestions && filteredNatures.length > 0}
                  aria-autocomplete="list"
                  {...collateralNatureRegistration}
                  ref={(el) => {
                    rhfNatureRef(el)
                    ;(natureInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
                  }}
                  onChange={(e) => {
                    collateralNatureRegistration.onChange(e)
                    setShowNatureSuggestions(true)
                    setHighlightedIndex(-1)
                  }}
                  onFocus={() => setShowNatureSuggestions(true)}
                  onBlur={(e) => {
                    collateralNatureRegistration.onBlur(e)
                    // Delay to allow click on suggestion
                    setTimeout(() => setShowNatureSuggestions(false), 150)
                  }}
                  onKeyDown={(e) => {
                    if (!showNatureSuggestions || filteredNatures.length === 0) return
                    if (e.key === "ArrowDown") {
                      e.preventDefault()
                      setHighlightedIndex((i) =>
                        i < filteredNatures.length - 1 ? i + 1 : 0
                      )
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault()
                      setHighlightedIndex((i) =>
                        i > 0 ? i - 1 : filteredNatures.length - 1
                      )
                    } else if (e.key === "Enter" && highlightedIndex >= 0) {
                      e.preventDefault()
                      setValue("collateralNature", filteredNatures[highlightedIndex], { shouldValidate: true })
                      setShowNatureSuggestions(false)
                      setHighlightedIndex(-1)
                    } else if (e.key === "Escape") {
                      setShowNatureSuggestions(false)
                    }
                  }}
                />
                {showNatureSuggestions && filteredNatures.length > 0 && (
                  <ul
                    ref={suggestionsRef}
                    role="listbox"
                    className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
                  >
                    {filteredNatures.map((nature, i) => (
                      <li
                        key={nature}
                        role="option"
                        aria-selected={i === highlightedIndex}
                        className={`cursor-pointer px-3 py-1.5 text-sm ${
                          i === highlightedIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50"
                        }`}
                        onMouseDown={() => {
                          setValue("collateralNature", nature, { shouldValidate: true })
                          setShowNatureSuggestions(false)
                          setHighlightedIndex(-1)
                        }}
                      >
                        {nature}
                      </li>
                    ))}
                  </ul>
                )}
                {errors.collateralNature && (
                  <p className="text-sm text-destructive">{errors.collateralNature.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="collateralDescription">Description (optional)</Label>
                <textarea
                  id="collateralDescription"
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring min-h-[80px] resize-y"
                  placeholder="Additional details about the collateral..."
                  {...register("collateralDescription")}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button type="button" onClick={handleStep2Next}>Next</Button>
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
                    <dd className="font-medium font-mono tabular-nums">{formatCurrency(principalAmount)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Issuance Fee</dt>
                    <dd className="font-medium font-mono tabular-nums">{formatCurrency(issuanceFee)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Description</dt>
                    <dd className="font-medium">{description}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Start Date</dt>
                    <dd className="font-medium font-mono tabular-nums">{formatDate(startDate)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Loan Type</dt>
                    <dd className="font-medium">{loanType === "fixed_rate" ? "Fixed Rate" : loanType === "reducing_balance" ? "Reducing Balance" : "Perpetual"}</dd>
                  </div>
                  {loanType !== "perpetual" && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Term</dt>
                      <dd className="font-medium">{termMonths} months</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Interest Rate</dt>
                    <dd className="font-medium font-mono tabular-nums">{interestRateDisplay}% per month</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Disbursement Source</dt>
                    <dd className="font-medium capitalize">
                      {disbursementSource === "strong_room" ? "Strong Room" : disbursementSource.charAt(0).toUpperCase() + disbursementSource.slice(1)}
                    </dd>
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

              {/* Rollover Breakdown */}
              {activeLoanData && (
                <div className="rounded-lg border p-3 space-y-2 text-sm">
                  <p className="font-medium">Rollover Breakdown</p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fresh Disbursement</span>
                    <span>{formatCurrency(principalAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rolled Over Amount</span>
                    <span>{formatCurrency(
                      new BigNumber(activeLoanData.outstandingPrincipal)
                        .plus(new BigNumber(activeLoanData.accruedInterest))
                        .toFixed(2)
                    )}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Total New Principal</span>
                    <span>{formatCurrency(
                      new BigNumber(principalAmount || "0")
                        .plus(new BigNumber(activeLoanData.outstandingPrincipal))
                        .plus(new BigNumber(activeLoanData.accruedInterest))
                        .toFixed(2)
                    )}</span>
                  </div>
                </div>
              )}

              {/* Interest Calculation Preview */}
              {loanSummary && (
                <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
                  <h3 className="text-sm font-medium">Interest Calculation Preview</h3>
                  {loanSummary.schedule ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>Total Interest: <span className="font-semibold">UGX {Number(loanSummary.totalInterest).toLocaleString()}</span></div>
                        <div>Total Owed: <span className="font-semibold">UGX {Number(loanSummary.totalOwed).toLocaleString()}</span></div>
                        <div>Monthly Installment: <span className="font-semibold">UGX {Number(loanSummary.monthlyInstallment).toLocaleString()}</span></div>
                      </div>
                      <div className="rounded-md border overflow-auto max-h-64">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left">Month</th>
                              <th className="px-3 py-2 text-right">Principal</th>
                              <th className="px-3 py-2 text-right">Interest</th>
                              <th className="px-3 py-2 text-right">Installment</th>
                              <th className="px-3 py-2 text-right">Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loanSummary.schedule.map((entry) => (
                              <tr key={entry.month} className="border-t">
                                <td className="px-3 py-2">{entry.month}</td>
                                <td className="px-3 py-2 text-right">{Number(entry.monthlyPrincipal).toLocaleString()}</td>
                                <td className="px-3 py-2 text-right">{Number(entry.monthlyInterest).toLocaleString()}</td>
                                <td className="px-3 py-2 text-right">{Number(entry.monthlyInstallment).toLocaleString()}</td>
                                <td className="px-3 py-2 text-right">{Number(entry.balanceAfter).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <>
                      <dl className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Daily interest amount</dt>
                          <dd className="font-medium font-mono tabular-nums">{formatCurrency(loanSummary.dailyInterest)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Total interest at minimum period</dt>
                          <dd className="font-medium font-mono tabular-nums">{formatCurrency(loanSummary.totalInterestAtMinPeriod)}</dd>
                        </div>
                        <div className="flex justify-between border-t border-border pt-2 mt-2">
                          <dt className="font-medium">Total owed at minimum period</dt>
                          <dd className="font-semibold font-mono tabular-nums">{formatCurrency(loanSummary.totalOwedAtMinPeriod)}</dd>
                        </div>
                      </dl>
                      <p className="text-xs text-muted-foreground">
                        Minimum interest period applies even if repaid early ({loanSummary.minInterestDays} days minimum).
                      </p>
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(2)} disabled={isPending}>
                  Back
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-4 w-4" />
                      Issuing Loan...
                    </>
                  ) : (
                    "Issue Loan"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </form>

      {/* POS Receipt Modal */}
      <PosReceiptModal
        open={receiptData !== null}
        onClose={() => {
          const customerId = receiptData?.customerId
          setReceiptData(null)
          if (customerId) {
            router.push(`/customers/${customerId}`)
          }
        }}
        title="Loan Disbursement Receipt"
      >
        {receiptData && (
          <PosReceiptDisbursement
            receiptNumber={receiptData.receiptNumber}
            date={receiptData.date}
            customerName={receiptData.customerName}
            loanAmount={receiptData.loanAmount}
            issuanceFee={receiptData.issuanceFee}
            description={receiptData.description}
            interestRate={receiptData.interestRate}
            collateralNature={receiptData.collateralNature}
            collateralDescription={receiptData.collateralDescription}
            disbursementSource={receiptData.disbursementSource}
            officerName={session?.user?.name ?? "Officer"}
          />
        )}
      </PosReceiptModal>
    </div>
  )
}

export default function NewLoanPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-6">Loading...</div>}>
      <NewLoanPageInner />
    </Suspense>
  )
}
