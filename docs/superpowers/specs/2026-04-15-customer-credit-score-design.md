# Customer Credit Score Design

## Overview

A client-side computed credit score (300–850, FICO-style) that quantifies how risky a customer is based on their loan and payment history. Displayed as a badge with a numeric score, ordinal label (Excellent/Very Good/Good/Fair/Poor/Very Poor), color indicator, and an info icon explaining the calculation.

## Score Range & Ordinal Bands

| Range   | Label     | Color       |
|---------|-----------|-------------|
| 800–850 | Excellent | Green       |
| 740–799 | Very Good | Light green |
| 670–739 | Good      | Blue        |
| 580–669 | Fair      | Amber       |
| 450–579 | Poor      | Orange      |
| 300–449 | Very Poor | Red         |

Customers with no loan history (zero non-pending loans) display "N/A — No loan history" instead of a numeric score.

## Scoring Factors

### 1. Repayment Timeliness (35%)

Measures how consistently a customer makes payments within 30-day cycles.

**Calculation:** For each loan, compute the average gap between consecutive payments (and from start date to first payment). Gaps <= 30 days score 1.0. Gaps > 30 days use a smooth decay: `score = 1.0 / (1 + ((avgGap - 30) / 30)^2)`.

**Recency weighting:** Recent loans weigh more than older loans.
**Size weighting:** Larger loans weigh more than smaller ones.

**Example:** A customer who pays every 25–30 days scores near 1.0. A customer who sometimes waits 60+ days between payments scores lower.

### 2. Loan Completion Rate (25%)

Ratio of successfully completed loans weighted by outcome.

**Per-loan scores:**
- `fully_paid` = 1.0
- `active` (in good standing) = 0.5
- `rolled_over` = 0.5 (not penalized — rolling over is a normal continuation)
- `settled_with_collateral` = 0.1

**Recency weighting:** Recent loans weigh more.
**Size weighting:** Larger loans weigh more.

**Example:** 4 out of 5 loans fully paid, 1 settled with collateral = strong score. A customer whose only loan was settled with collateral = very low score here.

### 3. Repeat Borrower History (20%)

Number of non-pending loans on a curve. More completed cycles = more trust.

**Curve:** 1 loan = 0.3, 2 = 0.5, 3 = 0.7, 4 = 0.85, 5+ = 1.0.

**Example:** A customer on their 5th loan scores 1.0 here. A first-time borrower scores 0.3.

### 4. Balance Paydown / Early Payoff (10%)

How quickly principal is reduced relative to the loan term.

**For completed loans:** If paid off faster than `minInterestDays`, apply a bonus (up to 1.0). Standard payoff within expected timeframe = 0.7. Slow payoff = lower.

**For active loans:** Ratio of principal paid down vs total principal. Higher paydown = higher score.

**Early payoff bonus:** Paying off a loan significantly faster than the minimum interest period earns up to a 1.0 score, signaling strong financial capacity.

**Example:** Paying off a 3-month minimum loan in 2 months earns a bonus. Paying it in 6 months scores lower.

### 5. Penalty Record (10%)

Ratio of loans with no penalties incurred to total non-pending loans.

**Calculation:** `clean_loans / total_loans`. All clean = 1.0.

**Example:** 0 penalties across 3 loans = 1.0. Penalties on 2 out of 4 loans = 0.5.

## Weighting Modifiers

### Recency Weighting (applies to factors 1 and 2)

Loans are weighted by how recent they are. A loan from 6 months ago counts more than one from 2 years ago. Uses exponential decay based on loan age: `weight = e^(-age_in_days / 365)`. This means a loan from today has weight 1.0, a 1-year-old loan has weight ~0.37, a 2-year-old loan has weight ~0.14.

### Size Weighting (applies to factors 1 and 2)

Loans are weighted by principal amount relative to the customer's largest loan. `weight = principalAmount / maxPrincipal`. A 5M loan carries more weight than a 200K loan.

### Combined Weight

For factors that use both recency and size: `combinedWeight = recencyWeight * sizeWeight`. Weights are normalized so they sum to 1 across all loans.

## Final Score Formula

```
compositeScore = (timeliness * 0.35) + (completion * 0.25) + (history * 0.20) + (paydown * 0.10) + (penalties * 0.10)

finalScore = 300 + (compositeScore * 550)
```

This maps the 0–1 composite to the 300–850 range with smooth, continuous distribution.

## UI Components

### `<CreditScoreBadge>` (`src/components/credit-score/credit-score-badge.tsx`)

Displays:
- Numeric score (e.g., "742")
- Ordinal label (e.g., "Very Good")
- Color indicator matching the band
- Info icon (i) that opens a popover

For no history: "N/A — No loan history" with info icon.

### Info Popover Content

When the info icon is clicked, a popover explains:

1. **Score range:** "Credit scores range from 300 (highest risk) to 850 (lowest risk)."

2. **Each factor with weight and example:**
   - "**Repayment Timeliness (35%):** How consistently payments are made within 30-day cycles. Example: A customer who pays every 25–30 days scores higher than one who sometimes waits 60+ days."
   - "**Loan Completion (25%):** Ratio of fully paid loans. Example: 4 out of 5 loans fully paid = strong score. Loans settled with collateral lower this significantly."
   - "**Borrowing History (20%):** More completed loan cycles build trust. Example: A customer on their 5th loan scores higher than a first-time borrower."
   - "**Balance Paydown (10%):** How quickly principal is reduced. Paying off loans early earns a bonus. Example: Paying off a 3-month loan in 2 months = top score."
   - "**Penalty Record (10%):** Fewer penalties = better score. Example: 0 penalties across 3 loans = perfect score here."

3. **Ordinal band table** with all 6 tiers.

4. **Note on weighting:** "Recent and larger loans influence the score more than older, smaller ones."

## File Structure

### New Files
- `src/lib/credit-score.ts` — pure `calculateCreditScore()` function
- `src/components/credit-score/credit-score-badge.tsx` — badge + info popover component

### Modified Files
- `src/app/(app)/customers/[id]/page.tsx` — add badge near customer header
- `src/app/(app)/loans/new/_components/loan-details-step.tsx` — add badge after customer selection

## Data Flow

- Both pages already load loans via TanStack DB collections (`loanCollection`)
- The badge filters loans by `customerId`, passes them to `calculateCreditScore()`
- Payments available through existing payment collection
- No new server actions, collections, or schema changes needed

## Dependencies

- Existing shadcn/ui `Popover` for info icon
- Existing `Badge` component patterns
- Tailwind classes for color coding
