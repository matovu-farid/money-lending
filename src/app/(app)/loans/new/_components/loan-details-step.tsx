import React, { useEffect, useRef } from "react"
import { Controller } from "react-hook-form"
import type { UseFormRegister, UseFormWatch, Control, FieldErrors } from "react-hook-form"
import type { LoanType } from "@/types"
import BigNumber from "bignumber.js"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { InfoPopover } from "@/components/ui/info-popover"
import { MoneyInput } from "@/components/ui/money-input"
import { DisbursementSourceSelect } from "@/components/loans/disbursement-source-select"
import { RolloverBanner } from "@/components/loans/rollover-banner"
import type { LoanFormValues } from "../_types"
import { todayDateString } from "@/lib/utils"
import { PERPETUAL_LOAN_MIN_AMOUNT, PRINCIPAL_AMOUNT_PRESETS } from "@/lib/constants"
import type { UserRole } from "@/types"
import { usePermissions } from "@/hooks/use-permissions"
import { CreditScoreBadge } from "@/components/credit-score/credit-score-badge"

interface ActiveLoanInfo {
  loan: { id: string; customerId: string }
  customerName: string
  outstandingPrincipal: string
  accruedInterest: string
}

interface LoanDetailsStepProps {
  register: UseFormRegister<LoanFormValues>
  watch: UseFormWatch<LoanFormValues>
  control: Control<LoanFormValues>
  errors: FieldErrors<LoanFormValues>
  prefilledCustomerId: string
  customerName: string | null
  activeLoanData: ActiveLoanInfo | null | undefined
  loanType: LoanType
  setLoanType: (t: LoanType) => void
  termMonths: string
  setTermMonths: (v: string) => void
  startDate: string
  principalAmount: string
  locationBalances: Record<"cash" | "bank" | "strong_room", string> | null | undefined
  bankAccountBalances?: Record<string, string>
  userRole: UserRole
  onNext: () => void
}

export function LoanDetailsStep({
  register,
  watch,
  control,
  errors,
  prefilledCustomerId,
  customerName,
  activeLoanData,
  loanType,
  setLoanType,
  termMonths,
  setTermMonths,
  startDate,
  principalAmount,
  locationBalances,
  bankAccountBalances,
  userRole,
  onNext,
}: LoanDetailsStepProps) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-1">
          <Label htmlFor="customerId" className="font-semibold">Customer</Label>
          {prefilledCustomerId && customerName ? (
            <>
              <Input
                id="customerId"
                value={customerName}
                disabled
                className="bg-muted"
              />
              <CreditScoreBadge customerId={prefilledCustomerId} className="mt-2" />
            </>
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

        <MoneyInput
          name="principalAmount"
          control={control}
          label="Principal Amount (UGX)"
          required="Principal amount is required"
          id="principalAmount"
          presets={PRINCIPAL_AMOUNT_PRESETS}
        />
        {userRole === "loanOfficer" && parseFloat(principalAmount?.replace(/,/g, "") || "0") > 4_000_000 && (
          <p className="text-sm text-destructive">Loan officers cannot issue more than 4,000,000 UGX.</p>
        )}

        <LoanTypeSelector
          loanType={loanType}
          setLoanType={setLoanType}
          disabled={!!activeLoanData}
          principalAmount={principalAmount}
          userRole={userRole}
          activeLoanData={activeLoanData}
        />

        <div className="space-y-2">
          <Label htmlFor="termMonths" className="font-semibold">
            {loanType === "perpetual" ? "Loan Period (months)" : "Term (months)"}
          </Label>
          <Input
            id="termMonths"
            type="number"
            min="1"
            step="1"
            value={termMonths}
            onChange={(e) => setTermMonths(e.target.value)}
            placeholder="e.g. 6"
          />
          {loanType === "perpetual" && (
            <p className="text-xs text-muted-foreground">
              Optional — record-only. Does not affect interest calculations on perpetual loans.
            </p>
          )}
        </div>

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

        <StartDateField
          control={control}
          register={register}
          errors={errors}
          startDate={startDate}
        />

        <InterestRateField register={register} errors={errors} interestRateDisplay={watch("interestRateDisplay")} />

        <DisbursementSourceSelect
          name="disbursementSource"
          control={control}
          locationBalances={locationBalances}
          bankAccountBalances={bankAccountBalances}
          amount={principalAmount}
          userRole={userRole}
          subLocationName="subLocationId"
        />

        <div className="flex gap-3 pt-2">
          <Button type="button" onClick={onNext}>Next</Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* ---------- Sub-components ---------- */

function LoanTypeSelector({
  loanType,
  setLoanType,
  disabled,
  principalAmount,
  userRole,
  activeLoanData,
}: {
  loanType: LoanType
  setLoanType: (t: LoanType) => void
  disabled: boolean
  principalAmount: string
  userRole: UserRole
  activeLoanData: ActiveLoanInfo | null | undefined
}) {
  const enteredAmount = new BigNumber(principalAmount?.replace(/,/g, "") || "0")
  const effectiveAmount = activeLoanData
    ? enteredAmount
        .plus(new BigNumber(activeLoanData.outstandingPrincipal))
        .plus(new BigNumber(activeLoanData.accruedInterest))
    : enteredAmount
  const perpetualAllowed = effectiveAmount.gte(PERPETUAL_LOAN_MIN_AMOUNT)
  const reducingBalanceAllowed = userRole !== "loanOfficer"

  // The React Compiler auto-memoises this derivation — manual `useMemo` was
  // flagged for "preserve-manual-memoization" because the compiler can't
  // guarantee the dep list won't be mutated. The compiler picks up the
  // reactive deps (perpetualAllowed, reducingBalanceAllowed) itself.
  const allOptions: { value: LoanType; label: string }[] = [
    { value: "perpetual", label: "Perpetual" },
    { value: "fixed_rate", label: "Fixed Rate" },
    { value: "reducing_balance", label: "Reducing Balance" },
  ]
  const availableOptions = allOptions.filter((o) => {
    if (o.value === "perpetual" && !perpetualAllowed) return false
    if (o.value === "reducing_balance" && !reducingBalanceAllowed) return false
    return true
  })

  // Track whether the user explicitly picked a loan type — if not, default to
  // perpetual whenever the amount qualifies.
  const userPickedRef = useRef(false)
  const handlePick = (t: LoanType) => {
    userPickedRef.current = true
    setLoanType(t)
  }

  useEffect(() => {
    if (disabled) return
    const isCurrentAvailable = availableOptions.some((o) => o.value === loanType)
    if (!isCurrentAvailable) {
      setLoanType(availableOptions[0]?.value ?? "fixed_rate")
      return
    }
    if (!userPickedRef.current && perpetualAllowed && loanType !== "perpetual") {
      setLoanType("perpetual")
    }
  }, [availableOptions, perpetualAllowed, loanType, disabled, setLoanType])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label className="font-semibold">Loan Type</Label>
        <InfoPopover>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-semibold">Perpetual</p>
              <p className="text-muted-foreground">No fixed end date. Interest accrues daily on the remaining balance (reducing balance). As the borrower pays, the balance drops and so does the daily interest. Minimum 30-day interest period applies.</p>
              <p className="text-muted-foreground text-xs mt-1">Available for loans of 2,000,000 UGX and above.</p>
            </div>
            <div>
              <p className="font-semibold">Fixed Rate</p>
              <p className="text-muted-foreground">A fixed repayment schedule over a set term. Monthly installments are equal (principal + interest). Total interest is calculated upfront.</p>
            </div>
            <div>
              <p className="font-semibold">Reducing Balance</p>
              <p className="text-muted-foreground">Interest is calculated on the remaining principal each month. As principal is paid down, interest decreases. Monthly installments start higher and decrease over time.</p>
              <p className="text-muted-foreground text-xs mt-1">Requires Supervisor or above role.</p>
            </div>
          </div>
        </InfoPopover>
      </div>
      <div className="flex gap-4">
        {availableOptions.map((option) => (
          <label key={option.value} className={`flex items-center gap-2 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
            <input
              type="radio"
              name="loanType"
              value={option.value}
              checked={loanType === option.value}
              onChange={(e) => handlePick(e.target.value as LoanType)}
              className="accent-primary"
              disabled={disabled}
            />
            <span className="text-sm">{option.label}</span>
          </label>
        ))}
      </div>
      {!perpetualAllowed && effectiveAmount.gt(0) && (
        <p className="text-xs text-muted-foreground">
          {activeLoanData
            ? "Perpetual loans require an effective principal (entered + rollover) of 2,000,000 UGX or more."
            : "Perpetual loans require a minimum of 2,000,000 UGX."}
        </p>
      )}
      {!reducingBalanceAllowed && (
        <p className="text-xs text-muted-foreground">
          Reducing Balance is available to Supervisors and above.
        </p>
      )}
    </div>
  )
}

function StartDateField({
  control,
  register,
  errors,
  startDate,
}: {
  control: Control<LoanFormValues>
  register: UseFormRegister<LoanFormValues>
  errors: FieldErrors<LoanFormValues>
  startDate: string
}) {
  return (
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
      <Controller
        name="startDate"
        control={control}
        rules={{
          required: "Start date is required",
          validate: (v) => {
            const selected = new Date(v)
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            selected.setHours(0, 0, 0, 0)
            if (selected.getTime() > today.getTime()) return "Start date cannot be in the future"
            return true
          },
        }}
        render={({ field }) => (
          <DatePicker
            id="startDate"
            value={field.value}
            onChange={field.onChange}
            max={todayDateString()}
          />
        )}
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
  )
}

/**
 * Minimum interest rate (%) the user's permissions allow.
 * - rate-change:approve-low (admin+): no floor
 * - rate-change:approve-standard (supervisor+): 8%
 * - everyone else: 10%
 */
function useMinRate(): number {
  const { has } = usePermissions()
  if (has("rate-change:approve-low")) return 0
  if (has("rate-change:approve-standard")) return 8
  return 10
}

function InterestRateField({
  register,
  errors,
  interestRateDisplay,
}: {
  register: UseFormRegister<LoanFormValues>
  errors: FieldErrors<LoanFormValues>
  interestRateDisplay: string
}) {
  const minRate = useMinRate()
  const rateValue = parseFloat(interestRateDisplay)
  const needsReason = !isNaN(rateValue) && rateValue < 10

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Label htmlFor="interestRate" className="font-semibold">Interest Rate (% per month)</Label>
        <InfoPopover>
          <p className="font-semibold text-sm mb-2">Interest Rate Permissions</p>
          <div className="text-xs text-muted-foreground space-y-2">
            <ul className="list-disc pl-4 space-y-1">
              <li><strong>10% or above</strong> — Any role can set this.</li>
              <li><strong>8% to 9.9%</strong> — Requires <strong>Supervisor</strong> or above.</li>
              <li><strong>Below 8%</strong> — Requires <strong>Admin</strong> or above.</li>
            </ul>
            <p className="pt-1">Need a lower rate? Create the loan first, then use <strong>Request Rate Change</strong> on the loan detail page to submit a change for approval.</p>
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
        min={minRate || "0"}
        step="0.1"
        placeholder="10"
        {...register("interestRateDisplay", {
          required: "Interest rate is required",
          validate: (v) => {
            const n = parseFloat(v)
            if (isNaN(n) || n <= 0) return "Interest rate must be greater than 0"
            if (n < minRate) return `Your role requires a minimum rate of ${minRate}%`
            return true
          },
        })}
      />
      {errors.interestRateDisplay && (
        <p className="text-sm text-destructive">{errors.interestRateDisplay.message}</p>
      )}
      {minRate > 0 && (
        <p className="text-xs text-muted-foreground">
          Your role allows rates of {minRate}% and above. To set a lower rate, request a rate change after the loan is created.
        </p>
      )}
      {needsReason && (
        <div className="space-y-1 mt-2">
          <Label htmlFor="lowRateReason" className="font-semibold text-sm">Reason for low rate</Label>
          <textarea
            id="lowRateReason"
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring min-h-[60px] resize-y"
            placeholder="Explain why the interest rate is below 10%..."
            maxLength={500}
            {...register("lowRateReason", {
              validate: (v) => {
                const rate = parseFloat(interestRateDisplay)
                if (!isNaN(rate) && rate < 10 && !v?.trim()) {
                  return "A reason is required when the interest rate is below 10%"
                }
                return true
              },
            })}
          />
          {errors.lowRateReason && (
            <p className="text-sm text-destructive">{errors.lowRateReason.message}</p>
          )}
        </div>
      )}
    </div>
  )
}
