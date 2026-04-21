import { Loader2 } from "lucide-react"
import BigNumber from "bignumber.js"
import type { LoanType } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { InfoPopover } from "@/components/ui/info-popover"
import { formatDate, formatCurrency } from "@/lib/utils"
import type { calculateLoanSummary } from "@/lib/interest"

interface ActiveLoanInfo {
  loan: { id: string; customerId: string }
  customerName: string
  outstandingPrincipal: string
  accruedInterest: string
}

interface ReviewStepProps {
  customerName: string | null
  principalAmount: string
  issuanceFee: string
  startDate: string
  backdateNote: string
  officerName: string
  loanType: LoanType
  termMonths: string
  interestRateDisplay: string
  disbursementSource: string
  collateralNature: string
  collateralDescription: string
  activeLoanData: ActiveLoanInfo | null | undefined
  loanSummary: ReturnType<typeof calculateLoanSummary> | null
  isPending: boolean
  onBack: () => void
}

export function ReviewStep({
  customerName,
  principalAmount,
  issuanceFee,
  startDate,
  backdateNote,
  officerName,
  loanType,
  termMonths,
  interestRateDisplay,
  disbursementSource,
  collateralNature,
  collateralDescription,
  activeLoanData,
  loanSummary,
  isPending,
  onBack,
}: ReviewStepProps) {
  return (
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
              <dd className="font-semibold text-amber-700">{officerName}</dd>
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
                    return formatDate(d)
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
          <RolloverBreakdown
            principalAmount={principalAmount}
            outstandingPrincipal={activeLoanData.outstandingPrincipal}
            accruedInterest={activeLoanData.accruedInterest}
          />
        )}

        {/* Interest Calculation Preview */}
        {loanSummary && (
          <InterestPreview loanSummary={loanSummary} loanType={loanType} />
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onBack} disabled={isPending}>
            Back
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin h-4 w-4" />
                Issuing Loan...
              </>
            ) : (
              "Issue Loan"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* ---------- Sub-components ---------- */

function RolloverBreakdown({
  principalAmount,
  outstandingPrincipal,
  accruedInterest,
}: {
  principalAmount: string
  outstandingPrincipal: string
  accruedInterest: string
}) {
  return (
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
            new BigNumber(outstandingPrincipal)
              .plus(new BigNumber(accruedInterest))
              .toFixed(0)
          )}</span>
        </div>
        <Separator className="my-2" />
        <div className="flex justify-between font-semibold">
          <span>Total New Principal</span>
          <span>{formatCurrency(
            new BigNumber(principalAmount || "0")
              .plus(new BigNumber(outstandingPrincipal))
              .plus(new BigNumber(accruedInterest))
              .toFixed(0)
          )}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function InterestPreview({
  loanSummary,
  loanType,
}: {
  loanSummary: NonNullable<ReturnType<typeof calculateLoanSummary>>
  loanType: LoanType
}) {
  return (
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
  )
}
