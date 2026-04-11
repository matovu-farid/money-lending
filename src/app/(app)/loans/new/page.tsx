"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { Loader2 } from "lucide-react"
import { getCustomerAction } from "@/actions/customer.actions"
import { getCollateralNaturesAction, getCustomerLoansWithOverdueAction, getLoanCollateralAction, getLocationBalancesAction } from "@/actions/loan.actions"
import { checkCustomerActiveLoanAction } from "@/actions/settlement.actions"
import { useCreateLoan } from "@/hooks/use-create-loan"
import { useSession } from "@/lib/auth-client"
import { queryKeys } from "@/hooks/query-keys"
import { calculateLoanSummary } from "@/lib/interest"
import { generateReceiptNumber } from "@/lib/receipt-number"
import type { CollateralInput, LoanType, DepositLocation } from "@/types"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { InfoPopover } from "@/components/ui/info-popover"
import { MoneyInput } from "@/components/ui/money-input"
import { formatDate, formatCurrency } from "@/lib/utils"
import { DisbursementSourceSelect } from "@/components/loans/disbursement-source-select"
import { RolloverBanner } from "@/components/loans/rollover-banner"
import { PageHeader } from "@/components/ui/page-header"
import Link from "next/link"
import BigNumber from "bignumber.js"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptDisbursement } from "@/components/receipts/pos-receipt-disbursement"
import { useNewLoanFormStore } from "@/lib/stores/new-loan-form"

function todayISODate(): string {
  return new Date().toISOString().split("T")[0]
}

interface LoanFormValues {
  customerId: string
  principalAmount: string
  issuanceFee: string
  startDate: string
  interestRateDisplay: string
  disbursementSource: DepositLocation
  collateralNature: string
  collateralDescription: string
  backdateNote: string
}

interface ReceiptData {
  receiptNumber: string
  customerId: string
  customerName: string
  loanAmount: string
  issuanceFee: string
  interestRate: string
  collateralNature: string
  collateralDescription: string
  disbursementSource: string
  date: string
  rolloverAmount?: string
  totalNewPrincipal?: string
}

function NewLoanPageInner() {
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const router = useRouter()
  const createLoan = useCreateLoan()
  const { data: session } = useSession()
  const prefilledCustomerId = searchParams.get("customerId") ?? ""

  // Restore draft state from zustand store.
  // Read the snapshot once for initialisation — all subsequent writes go through setters.
  const draft = useNewLoanFormStore()
  const draftSnapshot = useRef(draft).current          // captured on first render only
  const resumingDraft = !prefilledCustomerId && !!draftSnapshot.customerId
  const initialCustomerId = prefilledCustomerId || draftSnapshot.customerId

  const [step, setStepRaw] = useState(resumingDraft ? draftSnapshot.step : 1)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)
  const [loanType, setLoanTypeRaw] = useState<LoanType>(resumingDraft ? draftSnapshot.loanType : "perpetual")
  const [termMonths, setTermMonthsRaw] = useState<string>(resumingDraft ? draftSnapshot.termMonths : "")

  // Wrap setters to sync to store
  const setStep = (s: number) => { setStepRaw(s); draft.setField("step", s) }
  const setLoanType = (t: LoanType) => { setLoanTypeRaw(t); draft.setField("loanType", t) }
  const setTermMonths = (v: string) => { setTermMonthsRaw(v); draft.setField("termMonths", v) }

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
      customerId: initialCustomerId,
      principalAmount: resumingDraft ? draftSnapshot.principalAmount : "",
      issuanceFee: resumingDraft ? (draftSnapshot.issuanceFee || "50000") : "50000",
      startDate: resumingDraft ? (draftSnapshot.startDate || todayISODate()) : todayISODate(),
      interestRateDisplay: resumingDraft ? (draftSnapshot.interestRateDisplay || "10") : "10",
      disbursementSource: resumingDraft ? draftSnapshot.disbursementSource : "cash",
      collateralNature: resumingDraft ? draftSnapshot.collateralNature : "",
      collateralDescription: resumingDraft ? draftSnapshot.collateralDescription : "",
      backdateNote: "",
    },
    mode: "onTouched",
  })

  // On mount: clear stale draft so the watch subscription below starts clean
  useEffect(() => {
    if (!resumingDraft) draft.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // runs once on mount

  // Sync form changes back to the store
  useEffect(() => {
    const subscription = watch((values) => {
      draft.setFields({
        customerId: values.customerId ?? "",
        principalAmount: values.principalAmount ?? "",
        issuanceFee: values.issuanceFee ?? "50000",
        startDate: values.startDate ?? todayISODate(),
        interestRateDisplay: values.interestRateDisplay ?? "10",
        disbursementSource: values.disbursementSource ?? "cash",
        collateralNature: values.collateralNature ?? "",
        collateralDescription: values.collateralDescription ?? "",
      })
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch])

  // Watch values for computed fields and display
  const customerId = watch("customerId")
  const principalAmount = watch("principalAmount")
  const startDate = watch("startDate")
  const interestRateDisplay = watch("interestRateDisplay")
  const collateralNature = watch("collateralNature")
  const collateralDescription = watch("collateralDescription")
  const issuanceFee = watch("issuanceFee")
  const disbursementSource = watch("disbursementSource")
  const backdateNote = watch("backdateNote")

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

  // Fetch current balances per deposit location
  const { data: locationBalances } = useQuery({
    queryKey: ["location-balances"],
    queryFn: async () => {
      const result = await getLocationBalancesAction()
      if ("error" in result) return null
      return result.data
    },
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

  // Fetch collateral from the active loan for pre-filling
  const activeLoanId = activeLoanData?.loan.id
  const { data: activeLoanCollateral } = useQuery({
    queryKey: ["active-loan-collateral", activeLoanId],
    queryFn: async () => {
      const result = await getLoanCollateralAction(activeLoanId!)
      if ("error" in result || !result.data) return null
      return result.data
    },
    enabled: !!activeLoanId,
  })

  // Pre-fill form from the active loan when detected (rollover scenario).
  // Guard: only apply if the active loan belongs to the current customerId in the form.
  const prefillAppliedRef = useRef<string | null>(null)
  const collateralPrefillRef = useRef<string | null>(null)
  const prevCustomerRef = useRef(customerId)
  // Reset prefill guards when customer changes so a new active loan can re-trigger prefill
  if (prevCustomerRef.current !== customerId) {
    prevCustomerRef.current = customerId
    prefillAppliedRef.current = null
    collateralPrefillRef.current = null
  }
  useEffect(() => {
    if (!activeLoanData || prefillAppliedRef.current === activeLoanData.loan.id) return
    // Stale guard — don't apply data from a different customer's loan
    if (activeLoanData.loan.customerId !== customerId) return
    prefillAppliedRef.current = activeLoanData.loan.id
    const oldLoan = activeLoanData.loan
    const ratePercent = new BigNumber(oldLoan.interestRateOverride ?? oldLoan.interestRate).multipliedBy(100).toFixed(1).replace(/\.0$/, "")
    setValue("interestRateDisplay", ratePercent)
    setValue("issuanceFee", "0", { shouldValidate: false })
    const oldLoanType = (oldLoan.loanType ?? "perpetual") as LoanType
    setLoanType(oldLoanType)
    if (oldLoan.termMonths) setTermMonths(String(oldLoan.termMonths))
  }, [activeLoanData, customerId, setValue, setLoanType, setTermMonths])

  // Pre-fill collateral from the active loan.
  // Same stale guard — only apply when the collateral query matches the current active loan.
  useEffect(() => {
    if (!activeLoanCollateral || !activeLoanId || collateralPrefillRef.current === activeLoanId) return
    // Ensure the active loan still belongs to the current customer
    if (activeLoanData?.loan.customerId !== customerId) return
    collateralPrefillRef.current = activeLoanId
    setValue("collateralNature", activeLoanCollateral.nature)
    if (activeLoanCollateral.description) {
      setValue("collateralDescription", activeLoanCollateral.description)
    }
  }, [activeLoanCollateral, activeLoanId, activeLoanData, customerId, setValue])

  // Interest preview (computed on render when at step 3)
  // For rollovers, use total new principal (fresh + carried amounts)
  const effectivePrincipal =
    activeLoanData && principalAmount
      ? new BigNumber(principalAmount)
          .plus(new BigNumber(activeLoanData.outstandingPrincipal))
          .plus(new BigNumber(activeLoanData.accruedInterest))
          .toFixed(0)
      : principalAmount

  const loanSummary =
    step === 3 && effectivePrincipal && interestRateDisplay
      ? calculateLoanSummary(
          effectivePrincipal,
          (parseFloat(interestRateDisplay) / 100).toFixed(10),
          loanType === "perpetual" ? 30 : undefined,
          loanType !== "perpetual" ? loanType : undefined,
          loanType !== "perpetual" ? parseInt(termMonths, 10) : undefined
        )
      : null

  // Step-level validation fields
  const step1Fields: (keyof LoanFormValues)[] = ["customerId", "principalAmount", "issuanceFee", "startDate", "interestRateDisplay", "disbursementSource", "backdateNote"]
  const step2Fields: (keyof LoanFormValues)[] = ["collateralNature", "collateralDescription"]

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
      description: data.collateralDescription.trim(),
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
        issuanceFee: rolloverData ? "0" : data.issuanceFee,
        interestRate: (parseFloat(data.interestRateDisplay) / 100).toFixed(10),
        minInterestDays: 30,
        startDate: new Date(data.startDate).toISOString(),
        collateral,
        disbursementSource: data.disbursementSource,
        loanType,
        termMonths: loanType !== "perpetual" ? parseInt(termMonths, 10) : undefined,
        rollover: rolloverData,
        backdateNote: data.backdateNote?.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          if (!("error" in result)) {
            setReceiptData({
              receiptNumber: generateReceiptNumber(),
              customerId: data.customerId,
              customerName: customerName ?? "Customer",
              loanAmount: data.principalAmount,
              issuanceFee: rolloverData ? "0" : data.issuanceFee,
              interestRate: `${data.interestRateDisplay}%`,
              collateralNature: data.collateralNature,
              collateralDescription: data.collateralDescription.trim(),
              disbursementSource: data.disbursementSource,
              date: new Date(data.startDate).toISOString(),
              ...(rolloverData ? {
                rolloverAmount: new BigNumber(rolloverData.carriedPrincipal)
                  .plus(new BigNumber(rolloverData.carriedInterest))
                  .toFixed(0),
                totalNewPrincipal: new BigNumber(data.principalAmount)
                  .plus(new BigNumber(rolloverData.carriedPrincipal))
                  .plus(new BigNumber(rolloverData.carriedInterest))
                  .toFixed(0),
              } : {}),
            })
            draft.clear()
          }
        },
      }
    )
  }

  // Merge the react-hook-form register ref with our local ref for the collateral nature input
  const { ref: rhfNatureRef, ...collateralNatureRegistration } = register("collateralNature", {
    required: "Collateral nature is required",
    maxLength: { value: 100, message: "Collateral nature is too long (max 100 characters)" },
  })

  return (
    <div className={`p-4 md:p-6 ${step === 3 ? "max-w-2xl" : "max-w-xl"}`}>
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
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-1">
                <Label htmlFor="customerId" className="font-semibold">Customer</Label>
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
                <div className="flex items-center gap-1.5">
                  <Label className="font-semibold">Loan Type</Label>
                  <InfoPopover>
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="font-semibold">Perpetual</p>
                        <p className="text-muted-foreground">No fixed end date. Interest accrues daily on the remaining balance (reducing balance). As the borrower pays, the balance drops and so does the daily interest. Minimum 30-day interest period applies.</p>
                      </div>
                      <div>
                        <p className="font-semibold">Fixed Rate</p>
                        <p className="text-muted-foreground">A fixed repayment schedule over a set term. Monthly installments are equal (principal + interest). Total interest is calculated upfront.</p>
                      </div>
                      <div>
                        <p className="font-semibold">Reducing Balance</p>
                        <p className="text-muted-foreground">Interest is calculated on the remaining principal each month. As principal is paid down, interest decreases. Monthly installments start higher and decrease over time.</p>
                      </div>
                    </div>
                  </InfoPopover>
                </div>
                <div className="flex gap-4">
                  {[
                    { value: "perpetual" as const, label: "Perpetual" },
                    { value: "fixed_rate" as const, label: "Fixed Rate" },
                    { value: "reducing_balance" as const, label: "Reducing Balance" },
                  ].map((option) => (
                    <label key={option.value} className={`flex items-center gap-2 ${activeLoanData ? "opacity-50" : "cursor-pointer"}`}>
                      <input
                        type="radio"
                        name="loanType"
                        value={option.value}
                        checked={loanType === option.value}
                        onChange={(e) => setLoanType(e.target.value as LoanType)}
                        className="accent-primary"
                        disabled={!!activeLoanData}
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {loanType !== "perpetual" && (
                <div className="space-y-2">
                  <Label htmlFor="termMonths" className="font-semibold">Term (months)</Label>
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
                label="Principal Amount (UGX)"
                required="Principal amount is required"
                id="principalAmount"
              />

              {!activeLoanData && (
                <MoneyInput
                  name="issuanceFee"
                  control={control}
                  label="Issuance Fee (UGX)"
                  required="Issuance fee is required"
                  id="issuanceFee"
                  min={50000}
                />
              )}

              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="startDate" className="font-semibold">Start Date</Label>
                  <InfoPopover>
                    <p className="font-semibold text-sm mb-1">Backdating Loans</p>
                    <div className="text-xs text-muted-foreground space-y-1.5">
                      <p>You can set the start date to a past date if the loan was issued earlier but is being entered into the system now.</p>
                      <p><strong>1-3 days ago</strong> — Any loan officer can backdate. A note explaining the reason is required.</p>
                      <p><strong>More than 3 days ago</strong> — Requires <strong>Supervisor</strong> or above. A note is required.</p>
                      <p>All backdated loans are clearly marked with who backdated them and when.</p>
                    </div>
                  </InfoPopover>
                </div>
                <Input
                  id="startDate"
                  type="date"
                  max={todayISODate()}
                  {...register("startDate", {
                    required: "Start date is required",
                    validate: (v) => {
                      const selected = new Date(v)
                      const today = new Date()
                      today.setHours(0, 0, 0, 0)
                      selected.setHours(0, 0, 0, 0)
                      if (selected.getTime() > today.getTime()) return "Start date cannot be in the future"
                      return true
                    },
                  })}
                />
                {errors.startDate && (
                  <p className="text-sm text-destructive">{errors.startDate.message}</p>
                )}
                {(() => {
                  if (!startDate) return null
                  const selected = new Date(startDate)
                  const today = new Date()
                  today.setHours(0, 0, 0, 0)
                  selected.setHours(0, 0, 0, 0)
                  const days = Math.round((today.getTime() - selected.getTime()) / (1000 * 60 * 60 * 24))
                  if (days <= 0) return null
                  return (
                    <div className="space-y-2 mt-2">
                      <p className="text-sm text-amber-600 font-medium">
                        This loan will be backdated by {days} day{days > 1 ? "s" : ""}.
                        {days > 3 && " Supervisor permission required."}
                      </p>
                      <div className="space-y-1">
                        <Label htmlFor="backdateNote" className="font-semibold text-sm">Backdate Reason</Label>
                        <textarea
                          id="backdateNote"
                          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring min-h-[60px] resize-y"
                          placeholder="Explain why this loan is being backdated..."
                          maxLength={500}
                          {...register("backdateNote", {
                            validate: (v) => {
                              if (!startDate) return true
                              const sel = new Date(startDate)
                              const tod = new Date()
                              sel.setHours(0, 0, 0, 0)
                              tod.setHours(0, 0, 0, 0)
                              const d = Math.round((tod.getTime() - sel.getTime()) / (1000 * 60 * 60 * 24))
                              if (d > 0 && !v?.trim()) return "A note is required when backdating a loan"
                              return true
                            },
                          })}
                        />
                        {errors.backdateNote && (
                          <p className="text-sm text-destructive">{errors.backdateNote.message}</p>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="interestRate" className="font-semibold">Interest Rate (% per month)</Label>
                  <InfoPopover>
                    <p className="font-semibold text-sm mb-2">Interest Rate Permissions</p>
                    <div className="text-xs text-muted-foreground space-y-2">
                      <p>Any loan officer can set the initial rate when creating a loan.</p>
                      <p className="font-medium text-foreground">Changing the rate after creation:</p>
                      <ul className="list-disc pl-4 space-y-1">
                        <li><strong>10% or above</strong> — No approval needed, applies immediately.</li>
                        <li><strong>8% to 9.9%</strong> — Requires <strong>Supervisor</strong> approval.</li>
                        <li><strong>Below 8%</strong> — Requires <strong>Admin</strong> approval.</li>
                      </ul>
                      <p>If your role meets or exceeds the required approver role, the change applies immediately without waiting for approval.</p>
                      <p className="pt-1">Need a different rate? Create the loan first, then use the <strong>Request Rate Change</strong> button on the loan detail page to submit a change for approval.</p>
                      <Link
                        href="/approvals"
                        className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-primary hover:underline"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      >
                        View pending approvals &rarr;
                      </Link>
                    </div>
                  </InfoPopover>
                </div>
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

              <DisbursementSourceSelect
                name="disbursementSource"
                control={control}
                locationBalances={locationBalances}
                amount={principalAmount}
              />

              <div className="flex gap-3 pt-2">
                <Button type="button" onClick={handleStep1Next}>Next</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Collateral */}
        {step === 2 && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-1 relative">
                <Label htmlFor="collateralNature" className="font-semibold">Nature</Label>
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
                <Label htmlFor="collateralDescription" className="font-semibold">Description</Label>
                <textarea
                  id="collateralDescription"
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring min-h-[80px] resize-y"
                  placeholder="Describe the collateral and any extra details about the loan..."
                  maxLength={2500}
                  {...register("collateralDescription", {
                    required: "Collateral description is required",
                    maxLength: { value: 2500, message: "Description is too long (max 2500 characters)" },
                  })}
                />
                {errors.collateralDescription && (
                  <p className="text-sm text-destructive">{errors.collateralDescription.message}</p>
                )}
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
            <CardContent className="pt-6 space-y-6">
              {/* Loan Summary */}
              <dl className="space-y-2 text-sm">
                {customerName && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Customer</dt>
                    <dd className="font-semibold">{customerName}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Principal Amount</dt>
                  <dd className="font-semibold font-mono tabular-nums">{formatCurrency(principalAmount)}</dd>
                </div>
                {!activeLoanData && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Issuance Fee</dt>
                    <dd className="font-semibold font-mono tabular-nums">{formatCurrency(issuanceFee)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Start Date</dt>
                  <dd className="font-semibold font-mono tabular-nums">{formatDate(startDate)}</dd>
                </div>
                {backdateNote && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Backdated by</dt>
                    <dd className="font-semibold text-amber-700">{session?.user?.name ?? "Officer"}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Loan Type</dt>
                  <dd className="font-semibold">{loanType === "fixed_rate" ? "Fixed Rate" : loanType === "reducing_balance" ? "Reducing Balance" : "Perpetual"}</dd>
                </div>
                {loanType !== "perpetual" && (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Term</dt>
                      <dd className="font-semibold">{termMonths} months</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Maturity Date</dt>
                      <dd className="font-semibold font-mono tabular-nums">
                        {(() => {
                          const d = new Date(startDate)
                          d.setMonth(d.getMonth() + parseInt(termMonths, 10))
                          return formatDate(d.toISOString().split("T")[0])
                        })()}
                      </dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Interest Rate</dt>
                  <dd className="font-semibold font-mono tabular-nums">{interestRateDisplay}% per month</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Disbursement Source</dt>
                  <dd className="font-semibold capitalize">
                    {disbursementSource === "strong_room" ? "Strong Room" : disbursementSource.charAt(0).toUpperCase() + disbursementSource.slice(1)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Collateral</dt>
                  <dd className="font-semibold">{collateralNature}</dd>
                </div>
                {collateralDescription && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Collateral Description</dt>
                    <dd className="font-semibold max-w-[250px] truncate" title={collateralDescription}>{collateralDescription}</dd>
                  </div>
                )}
              </dl>

              {/* Rollover Breakdown */}
              {activeLoanData && (
                <Card>
                  <CardContent className="p-3 space-y-2 text-sm">
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
                          .toFixed(0)
                      )}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-semibold">
                      <span>Total New Principal</span>
                      <span>{formatCurrency(
                        new BigNumber(principalAmount || "0")
                          .plus(new BigNumber(activeLoanData.outstandingPrincipal))
                          .plus(new BigNumber(activeLoanData.accruedInterest))
                          .toFixed(0)
                      )}</span>
                    </div>
                  </CardContent>
                </Card>
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
                              <th className="px-3 py-2 text-right">
                                <span className="inline-flex items-center gap-1 justify-end">
                                  Principal
                                  <InfoPopover>
                                    <div className="space-y-1 text-sm">
                                      <p className="font-medium">Principal Portion</p>
                                      <p>The portion of your payment that goes toward reducing the loan amount.</p>
                                      <p className="font-mono text-xs bg-muted rounded px-2 py-1">Principal = Loan Amount / Term</p>
                                      <p className="text-muted-foreground">This stays the same each month.</p>
                                    </div>
                                  </InfoPopover>
                                </span>
                              </th>
                              <th className="px-3 py-2 text-right">
                                <span className="inline-flex items-center gap-1 justify-end">
                                  Interest
                                  <InfoPopover>
                                    {loanType === "reducing_balance" ? (
                                      <div className="space-y-1 text-sm">
                                        <p className="font-medium">Reducing Balance Interest</p>
                                        <p>Calculated on the <span className="font-semibold">remaining balance</span>, not the original loan amount.</p>
                                        <p className="font-mono text-xs bg-muted rounded px-2 py-1">Interest = Balance x Rate</p>
                                        <p className="text-muted-foreground">As you pay down principal, interest decreases each month.</p>
                                      </div>
                                    ) : (
                                      <div className="space-y-1 text-sm">
                                        <p className="font-medium">Fixed Rate Interest</p>
                                        <p>Calculated on the <span className="font-semibold">original principal</span> every month, regardless of payments made.</p>
                                        <p className="font-mono text-xs bg-muted rounded px-2 py-1">Interest = Original Principal x Rate</p>
                                        <p className="text-muted-foreground">The interest amount stays the same each month.</p>
                                      </div>
                                    )}
                                  </InfoPopover>
                                </span>
                              </th>
                              <th className="px-3 py-2 text-right">
                                <span className="inline-flex items-center gap-1 justify-end">
                                  Installment
                                  <InfoPopover>
                                    <div className="space-y-1 text-sm">
                                      <p className="font-medium">Monthly Installment</p>
                                      <p>The total amount due each month.</p>
                                      <p className="font-mono text-xs bg-muted rounded px-2 py-1">Installment = Principal + Interest</p>
                                    </div>
                                  </InfoPopover>
                                </span>
                              </th>
                              <th className="px-3 py-2 text-right">
                                <span className="inline-flex items-center gap-1 justify-end">
                                  Balance
                                  <InfoPopover>
                                    <div className="space-y-1 text-sm">
                                      <p className="font-medium">Remaining Balance</p>
                                      <p>The outstanding loan amount after this month&apos;s principal payment is applied.</p>
                                      <p className="font-mono text-xs bg-muted rounded px-2 py-1">Balance = Previous Balance - Principal</p>
                                    </div>
                                  </InfoPopover>
                                </span>
                              </th>
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
            queryClient.prefetchQuery({
              queryKey: queryKeys.customers.detail(customerId),
              queryFn: () => getCustomerAction(customerId),
              staleTime: 30_000,
            })
            queryClient.prefetchQuery({
              queryKey: queryKeys.loans.byCustomer(customerId),
              queryFn: () => getCustomerLoansWithOverdueAction(customerId),
              staleTime: 30_000,
            })
            router.prefetch(`/customers/${customerId}`)
            router.push(`/customers/${customerId}`)
          }
        }}
        title="Loan Disbursement Receipt"
        autoActions
      >
        {receiptData && (
          <PosReceiptDisbursement
            receiptNumber={receiptData.receiptNumber}
            date={receiptData.date}
            customerName={receiptData.customerName}
            loanAmount={receiptData.loanAmount}
            issuanceFee={receiptData.issuanceFee}
            interestRate={receiptData.interestRate}
            collateralNature={receiptData.collateralNature}
            disbursementSource={receiptData.disbursementSource}
            officerName={session?.user?.name ?? "Officer"}
            rolloverAmount={receiptData.rolloverAmount}
            totalNewPrincipal={receiptData.totalNewPrincipal}
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
