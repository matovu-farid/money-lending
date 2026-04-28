"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useLiveQuery, eq } from "@tanstack/react-db"
import { useForm } from "react-hook-form"
import { customerCollection } from "@/collections/customers"
import { collateralNaturesCollection, locationBalancesCollection, getActiveLoanCheckCollection, getLoanCollateralCollection } from "@/collections/loan-extras"
import { generateClientId } from "@/lib/client-id"
import { insertLoanWithInput } from "@/collections/loans"
import { useSession } from "@/lib/auth-client"

import { calculateLoanSummary } from "@/lib/interest"
import { generateReceiptNumber } from "@/lib/receipt-number"
import type { CollateralInput, CreateLoanInput, LoanType, LoanListEntry } from "@/types"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import BigNumber from "bignumber.js"
import { PosReceiptModal } from "@/components/receipts/pos-receipt-modal"
import { PosReceiptDisbursement } from "@/components/receipts/pos-receipt-disbursement"
import { useNewLoanFormStore } from "@/lib/stores/new-loan-form"
import { todayDateString } from "@/lib/utils"
import type { UserRole } from "@/types"
import type { LoanFormValues, ReceiptData } from "./_types"
import { StepIndicator } from "./_components/step-indicator"
import { LoanDetailsStep } from "./_components/loan-details-step"
import { CollateralStep } from "./_components/collateral-step"
import { ReviewStep } from "./_components/review-step"


function NewLoanPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session } = useSession()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const userRole = (session?.user?.role ?? "unassigned") as UserRole
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
      startDate: resumingDraft ? (draftSnapshot.startDate || todayDateString()) : todayDateString(),
      interestRateDisplay: resumingDraft ? (draftSnapshot.interestRateDisplay || "10") : "10",
      disbursementSource: resumingDraft ? draftSnapshot.disbursementSource : "cash",
      subLocationId: "",
      collateralNature: resumingDraft ? draftSnapshot.collateralNature : "",
      collateralDescription: resumingDraft ? draftSnapshot.collateralDescription : "",
      backdateNote: "",
      lowRateReason: "",
    },
    mode: "onTouched",
  })

  // On mount: clear stale draft so the watch subscription below starts clean
  useEffect(() => {
    if (!resumingDraft) draft.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // runs once on mount

  // Warm the loan-detail route + its per-loan dynamic collections as soon as
  // the receipt modal opens. By the time the user closes the receipt and
  // navigates, the route bundle is loaded and the collateral/balance fetches
  // have already started — eliminating the noticeable wait we saw post-issue.
  useEffect(() => {
    const id = receiptData?.loanId
    if (!id) return
    router.prefetch(`/loans/${id}`)
    // Touching this getter warms the collateral collection (startSync: true).
    // The loan_balances projection is globally synced via loanBalanceCollection
    // (Electric direct) — no explicit warmup needed.
    getLoanCollateralCollection(id)
  }, [receiptData?.loanId, router])

  // Sync form changes back to the store
  useEffect(() => {
    const subscription = watch((values) => {
      draft.setFields({
        customerId: values.customerId ?? "",
        principalAmount: values.principalAmount ?? "",
        issuanceFee: values.issuanceFee ?? "50000",
        startDate: values.startDate ?? todayDateString(),
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

  const isPending = isSubmitting

  // --- Data queries ---

  const { data: knownNaturesRows } = useLiveQuery((q) =>
    q.from({ n: collateralNaturesCollection }).select(({ n }) => n)
  )
  const knownNatures = (knownNaturesRows ?? []).map((r) => r.nature)

  const { data: locationBalancesRows } = useLiveQuery((q) =>
    q.from({ l: locationBalancesCollection }).select(({ l }) => l)
  )
  const lbRow = locationBalancesRows?.[0]
  const locationBalances: Record<"cash" | "bank" | "strong_room", string> | null = lbRow
    ? { cash: lbRow.cash, bank: lbRow.bank, strong_room: lbRow.strong_room }
    : null
  const bankAccountBalances = lbRow?.bankAccounts ?? {}

  const { data: matchedCustomers } = useLiveQuery(
    (q) => q.from({ c: customerCollection }).where(({ c }) => eq(c.id, prefilledCustomerId)),
    [prefilledCustomerId]
  )
  const customerName = matchedCustomers?.[0]?.fullName ?? null

  const activeLoanCheckColl = customerId ? getActiveLoanCheckCollection(customerId) : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activeLoanCheckRows } = useLiveQuery(((q: any) =>
    activeLoanCheckColl ? q.from({ a: activeLoanCheckColl }).select(({ a }: any) => a) : undefined
  ) as any, [customerId])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeLoanData = (activeLoanCheckRows as any)?.[0]?.data ?? null

  const activeLoanId = activeLoanData?.loan.id
  const activeLoanCollateralColl = activeLoanId ? getLoanCollateralCollection(activeLoanId) : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activeLoanCollateralRows } = useLiveQuery(((q: any) =>
    activeLoanCollateralColl ? q.from({ c: activeLoanCollateralColl }).select(({ c }: any) => c) : undefined
  ) as any, [activeLoanId])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeLoanCollateral = (activeLoanCollateralRows as any)?.[0] ?? null

  // --- Rollover pre-fill effects ---

  const prefillAppliedRef = useRef<string | null>(null)
  const collateralPrefillRef = useRef<string | null>(null)
  const prevCustomerRef = useRef(customerId)
  if (prevCustomerRef.current !== customerId) {
    prevCustomerRef.current = customerId
    prefillAppliedRef.current = null
    collateralPrefillRef.current = null
  }
  useEffect(() => {
    if (!activeLoanData || prefillAppliedRef.current === activeLoanData.loan.id) return
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

  useEffect(() => {
    if (!activeLoanCollateral || !activeLoanId || collateralPrefillRef.current === activeLoanId) return
    if (activeLoanData?.loan.customerId !== customerId) return
    collateralPrefillRef.current = activeLoanId
    setValue("collateralNature", activeLoanCollateral.nature)
    if (activeLoanCollateral.description) {
      setValue("collateralDescription", activeLoanCollateral.description)
    }
  }, [activeLoanCollateral, activeLoanId, activeLoanData, customerId, setValue])

  // --- Computed values ---

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

  // --- Step navigation ---

  const step1Fields: (keyof LoanFormValues)[] = ["customerId", "principalAmount", "issuanceFee", "startDate", "interestRateDisplay", "disbursementSource", "subLocationId", "backdateNote", "lowRateReason"]
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

  // --- Submit ---

  function onSubmit(data: LoanFormValues) {
    setIsSubmitting(true)

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

    const id = generateClientId()
    const interestRate = (parseFloat(data.interestRateDisplay) / 100).toFixed(10)
    const fee = rolloverData ? "0" : data.issuanceFee

    // Build optimistic LoanListEntry from form data
    const optimistic: LoanListEntry = {
      id,
      customerId: data.customerId,
      customerName: customerName ?? "Customer",
      customerContact: null,
      principalAmount: effectivePrincipal || data.principalAmount,
      issuanceFee: fee,
      interestRate,
      minInterestDays: 30,
      interestRateOverride: null,
      minPeriodOverride: null,
      startDate: new Date(data.startDate),
      status: "active",
      issuedBy: session?.user?.id ?? "",
      disbursementSource: data.disbursementSource,
      subLocationId: data.disbursementSource === "bank" ? data.subLocationId || null : null,
      loanType: loanType ?? "perpetual",
      termMonths: loanType !== "perpetual" ? parseInt(termMonths, 10) : null,
      penaltyMultiplier: "0.1000",
      penaltyWaived: false,
      penaltyWaivedBy: null,
      penaltyWaivedAt: null,
      rolledOverFrom: rolloverData?.fromLoanId ?? null,
      rolloverAmount: rolloverData
        ? new BigNumber(rolloverData.carriedPrincipal)
            .plus(new BigNumber(rolloverData.carriedInterest))
            .toFixed(0)
        : null,
      backdatedFrom: null,
      backdatedBy: null,
      backdatedAt: null,
      backdateNote: data.backdateNote?.trim() || null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      // LoanListEntry extra fields
      daysOverdue: 0,
      outstandingBalance: effectivePrincipal || data.principalAmount,
      dailyRate: "0",
      lastPaymentDate: null,
      unpaidInterest: "0",
    }

    const formInput: CreateLoanInput = {
      id,
      customerId: data.customerId,
      principalAmount: data.principalAmount,
      issuanceFee: fee,
      interestRate,
      minInterestDays: 30,
      startDate: new Date(data.startDate).toISOString(),
      collateral,
      disbursementSource: data.disbursementSource,
      subLocationId: data.disbursementSource === "bank" ? data.subLocationId || undefined : undefined,
      loanType,
      termMonths: loanType !== "perpetual" ? parseInt(termMonths, 10) : undefined,
      rollover: rolloverData,
      backdateNote: data.backdateNote?.trim() || undefined,
    }

    // Insert into collection (queues server action) and show receipt immediately
    insertLoanWithInput(id, optimistic, formInput)

    setReceiptData({
      receiptNumber: generateReceiptNumber(),
      loanId: id,
      customerId: data.customerId,
      customerName: customerName ?? "Customer",
      loanAmount: data.principalAmount,
      issuanceFee: fee,
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
    setIsSubmitting(false)
  }

  return (
    <div className={`p-4 md:p-6 ${step === 3 ? "max-w-2xl" : "max-w-xl"}`}>
      <PageHeader
        title="Issue New Loan"
        subtitle={`Step ${step} of 3`}
        className="mb-4"
      />

      <StepIndicator currentStep={step} />

      <form onSubmit={rhfHandleSubmit(onSubmit)}>
        {step === 1 && (
          <LoanDetailsStep
            register={register}
            watch={watch}
            control={control}
            errors={errors}
            prefilledCustomerId={prefilledCustomerId}
            customerName={customerName}
            activeLoanData={activeLoanData}
            loanType={loanType}
            setLoanType={setLoanType}
            termMonths={termMonths}
            setTermMonths={setTermMonths}
            startDate={startDate}
            principalAmount={principalAmount}
            locationBalances={locationBalances}
            bankAccountBalances={bankAccountBalances}
            userRole={userRole}
            onNext={handleStep1Next}
          />
        )}

        {step === 2 && (
          <CollateralStep
            register={register}
            setValue={setValue}
            errors={errors}
            knownNatures={knownNatures}
            collateralNature={collateralNature}
            onBack={() => setStep(1)}
            onNext={handleStep2Next}
          />
        )}

        {step === 3 && (
          <ReviewStep
            customerName={customerName}
            principalAmount={principalAmount}
            issuanceFee={issuanceFee}
            startDate={startDate}
            backdateNote={backdateNote}
            officerName={session?.user?.name ?? "Officer"}
            loanType={loanType}
            termMonths={termMonths}
            interestRateDisplay={interestRateDisplay}
            disbursementSource={disbursementSource}
            collateralNature={collateralNature}
            collateralDescription={collateralDescription}
            activeLoanData={activeLoanData}
            loanSummary={loanSummary}
            isPending={isPending}
            onBack={() => setStep(2)}
          />
        )}
      </form>

      {/* POS Receipt Modal */}
      <PosReceiptModal
        open={receiptData !== null}
        onClose={() => {
          const cId = receiptData?.customerId
          const loanId = receiptData?.loanId
          setReceiptData(null)
          if (loanId) {
            router.push(`/loans/${loanId}`)
          } else if (cId) {
            router.push(`/customers/${cId}`)
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
