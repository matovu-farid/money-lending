import type { LoanListEntry } from "@/types/loan"
import type { PaymentWithCustomer } from "@/types/payment"
import {
  isPenaltyActive,
  PENALTY_THRESHOLD_DAYS,
} from "@/lib/interest/effective-rate"

/** Normalize a Date or serialized ISO string to a Date object */
function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d)
}

/** Days between two dates (absolute calendar-ish gap via ms). */
function daysBetween(a: Date | string, b: Date | string): number {
  return Math.abs(toDate(b).getTime() - toDate(a).getTime()) / (1000 * 60 * 60 * 24)
}

/**
 * For terminal loans Path A zeros daysOverdue — reconstruct whether a penalty
 * would have applied from payment gaps / durable waive flag (R15-5).
 */
export function terminalLoanHadPenalty(
  loan: Pick<LoanListEntry, "startDate" | "penaltyWaived" | "lastPaymentDate">,
  payments: Array<{ paymentDate: Date | string }>,
): boolean {
  if (loan.penaltyWaived === true) return true
  const sorted = [...payments].sort(
    (a, b) => toDate(a.paymentDate).getTime() - toDate(b.paymentDate).getTime(),
  )
  let prev = toDate(loan.startDate)
  for (const p of sorted) {
    if (daysBetween(prev, p.paymentDate) >= PENALTY_THRESHOLD_DAYS) return true
    prev = toDate(p.paymentDate)
  }
  // Gap from last payment (or start) to loan close signal (lastPaymentDate)
  const end = loan.lastPaymentDate ? toDate(loan.lastPaymentDate) : prev
  if (sorted.length === 0) {
    return daysBetween(loan.startDate, end) >= PENALTY_THRESHOLD_DAYS
  }
  return false
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreditScoreResult {
  score: number | null
  label: string
  color: string
}

export interface CreditScoreBreakdown {
  timeliness: number
  completion: number
  history: number
  paydown: number
  penalties: number
  composite: number
  finalScore: number | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCORE_MIN = 300
const SCORE_MAX = 850
const SCORE_RANGE = SCORE_MAX - SCORE_MIN // 550

const WEIGHTS = {
  timeliness: 0.35,
  completion: 0.25,
  history: 0.20,
  paydown: 0.10,
  penalties: 0.10,
} as const

// ---------------------------------------------------------------------------
// Score Bands
// ---------------------------------------------------------------------------

interface ScoreBand { min: number; label: string; color: string }

const SCORE_BANDS: ScoreBand[] = [
  { min: 800, label: "Excellent", color: "text-green-700 bg-green-100 border-green-300 dark:text-green-400 dark:bg-green-950 dark:border-green-800" },
  { min: 740, label: "Very Good", color: "text-emerald-700 bg-emerald-100 border-emerald-300 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800" },
  { min: 670, label: "Good", color: "text-blue-700 bg-blue-100 border-blue-300 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800" },
  { min: 580, label: "Fair", color: "text-amber-700 bg-amber-100 border-amber-300 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800" },
  { min: 450, label: "Poor", color: "text-orange-700 bg-orange-100 border-orange-300 dark:text-orange-400 dark:bg-orange-950 dark:border-orange-800" },
  { min: 0,   label: "Very Poor", color: "text-red-700 bg-red-100 border-red-300 dark:text-red-400 dark:bg-red-950 dark:border-red-800" },
]

export function getBand(score: number): { label: string; color: string } {
  for (const band of SCORE_BANDS) {
    if (score >= band.min) return { label: band.label, color: band.color }
  }
  return { label: "Very Poor", color: SCORE_BANDS[SCORE_BANDS.length - 1].color }
}

// ---------------------------------------------------------------------------
// Weighting Helpers
// ---------------------------------------------------------------------------

export function recencyWeight(loanStartDate: Date, now: Date): number {
  const ageInDays = Math.max(0, (toDate(now).getTime() - toDate(loanStartDate).getTime()) / (1000 * 60 * 60 * 24))
  return Math.exp(-ageInDays / 365)
}

export function sizeWeight(principalAmount: string, maxPrincipal: string): number {
  const max = parseFloat(maxPrincipal)
  if (max <= 0) return 1.0
  return parseFloat(principalAmount) / max
}

export function combinedWeights(
  loans: Array<{ startDate: Date; principalAmount: string }>,
  now: Date,
): number[] {
  if (loans.length === 0) return []
  const maxPrincipal = Math.max(...loans.map((l) => parseFloat(l.principalAmount))).toString()
  const raw = loans.map((l) => recencyWeight(l.startDate, now) * sizeWeight(l.principalAmount, maxPrincipal))
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum === 0) return loans.map(() => 1 / loans.length)
  return raw.map((w) => w / sum)
}

// ---------------------------------------------------------------------------
// Factor Functions
// ---------------------------------------------------------------------------

export function scoreTimeliness(
  loan: { startDate: Date; principalAmount: string; status: string },
  payments: Array<{ paymentDate: Date }>,
  now: Date = new Date(),
): number {
  if (payments.length === 0) return 0.5
  const sorted = [...payments].sort((a, b) => toDate(a.paymentDate).getTime() - toDate(b.paymentDate).getTime())
  const gaps: number[] = []
  const firstGap = (toDate(sorted[0].paymentDate).getTime() - toDate(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
  gaps.push(Math.max(0, firstGap))
  for (let i = 1; i < sorted.length; i++) {
    const gap = (toDate(sorted[i].paymentDate).getTime() - toDate(sorted[i - 1].paymentDate).getTime()) / (1000 * 60 * 60 * 24)
    gaps.push(Math.max(0, gap))
  }
  if (loan.status === "active") {
    const trailingGap = (toDate(now).getTime() - toDate(sorted[sorted.length - 1].paymentDate).getTime()) / (1000 * 60 * 60 * 24)
    gaps.push(Math.max(0, trailingGap))
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (avgGap <= 30) return 1.0
  const excess = (avgGap - 30) / 30
  return 1.0 / (1.0 + excess * excess)
}

export function scoreCompletion(status: string): number {
  switch (status) {
    case "fully_paid": return 1.0
    case "active": return 0.5
    case "rolled_over": return 0.5
    case "settled_with_collateral": return 0.1
    default: return 0.0
  }
}

export function scoreHistory(loanCount: number): number {
  const curve: Record<number, number> = { 1: 0.3, 2: 0.5, 3: 0.7, 4: 0.85 }
  if (loanCount >= 5) return 1.0
  return curve[loanCount] ?? 0.0
}

export function scorePaydown(
  loan: { status: string; startDate: Date; minInterestDays: number; principalAmount: string },
  outstandingBalance: string,
  lastPaymentDate: Date | null,
): number {
  // Terminal lifecycle statuses: do not use zeroed display balances (R13-3)
  if (loan.status === "rolled_over" || loan.status === "settled_with_collateral") {
    return 0.5
  }

  const principal = parseFloat(loan.principalAmount)
  const outstanding = parseFloat(outstandingBalance)
  if (loan.status === "fully_paid" && lastPaymentDate) {
    const daysToPayoff = (toDate(lastPaymentDate).getTime() - toDate(loan.startDate).getTime()) / (1000 * 60 * 60 * 24)
    const minDays = loan.minInterestDays
    if (daysToPayoff <= minDays * 0.7) return 1.0
    if (daysToPayoff <= minDays) return 0.85
    if (daysToPayoff <= minDays * 1.5) return 0.7
    return 0.5
  }
  if (principal <= 0) return 0.5
  const paidRatio = Math.max(0, Math.min(1, 1 - outstanding / principal))
  return paidRatio
}

export function scorePenalties(hadPenalty: boolean): number {
  return hadPenalty ? 0.0 : 1.0
}

// ---------------------------------------------------------------------------
// Main Calculator
// ---------------------------------------------------------------------------

export function calculateCreditScore(
  loans: LoanListEntry[],
  payments: PaymentWithCustomer[],
): CreditScoreResult {
  const scorableLoans = loans.filter((l) => l.status !== "pending")
  if (scorableLoans.length === 0) {
    return { score: null, label: "No loan history", color: "text-muted-foreground bg-muted border-border" }
  }
  const now = new Date()
  const paymentsByLoan = new Map<string, PaymentWithCustomer[]>()
  for (const p of payments) {
    const existing = paymentsByLoan.get(p.loanId) ?? []
    existing.push(p)
    paymentsByLoan.set(p.loanId, existing)
  }
  const weights = combinedWeights(
    scorableLoans.map((l) => ({ startDate: l.startDate, principalAmount: l.principalAmount })),
    now,
  )
  let timeliness = 0
  for (let i = 0; i < scorableLoans.length; i++) {
    const loan = scorableLoans[i]
    const loanPayments = (paymentsByLoan.get(loan.id) ?? []).map((p) => ({ paymentDate: p.paymentDate }))
    timeliness += scoreTimeliness(loan, loanPayments) * weights[i]
  }
  let completion = 0
  for (let i = 0; i < scorableLoans.length; i++) {
    completion += scoreCompletion(scorableLoans[i].status) * weights[i]
  }
  const history = scoreHistory(scorableLoans.length)
  let paydown = 0
  for (let i = 0; i < scorableLoans.length; i++) {
    const loan = scorableLoans[i]
    paydown += scorePaydown(
      { status: loan.status, startDate: loan.startDate, minInterestDays: loan.minInterestDays, principalAmount: loan.principalAmount },
      loan.outstandingBalance,
      loan.lastPaymentDate,
    ) * weights[i]
  }
  const penaltyLoans = scorableLoans.filter((l) => {
    // Path A zeros daysOverdue on terminal loans — use durable flags + payment gaps (R15-5)
    if (
      l.status === "rolled_over" ||
      l.status === "fully_paid" ||
      l.status === "settled_with_collateral"
    ) {
      return terminalLoanHadPenalty(l, paymentsByLoan.get(l.id) ?? [])
    }
    return isPenaltyActive(l.daysOverdue, l.penaltyWaived)
  })
  const penalties = scorableLoans.length > 0
    ? (scorableLoans.length - penaltyLoans.length) / scorableLoans.length
    : 1.0
  const composite =
    timeliness * WEIGHTS.timeliness +
    completion * WEIGHTS.completion +
    history * WEIGHTS.history +
    paydown * WEIGHTS.paydown +
    penalties * WEIGHTS.penalties
  const finalScore = Math.round(SCORE_MIN + composite * SCORE_RANGE)
  const clamped = Math.max(SCORE_MIN, Math.min(SCORE_MAX, finalScore))
  const { label, color } = getBand(clamped)
  return { score: clamped, label, color }
}
