# Design: Supervisor Role, Rate Approval, Issuance Fee, POS Receipts & Cash Management

**Date:** 2026-04-04
**Status:** Approved

## Overview

Five interconnected features for the money lending system:

1. **Supervisor role** with updated hierarchy
2. **Interest rate approval flow** with role-based thresholds
3. **Loan issuance fee** (min 50,000, income line item)
4. **Auto-generated POS receipts** for loan issuance and payment registration
5. **Cash management** with three deposit locations (cash, bank, strong room)
6. **Loan description required** — make existing optional field compulsory

---

## 1. Supervisor Role & Updated Hierarchy

### Role Hierarchy

```
unassigned (0) → loanOfficer (1) → supervisor (2) → admin (3) → superAdmin (4)
```

### Changes

- Add `supervisor` to `ROLE_LEVELS` in `src/lib/permissions.ts` at level 2
- Shift `admin` to level 3, `superAdmin` to level 4
- Add `supervisor` to role assignment dropdown on admin page
- Update sidebar visibility for supervisor-level features

### Supervisor Capabilities

- Everything a loan officer can do
- Can approve rate change requests for 8-10% range
- Can assign/manage loan officers
- Cannot approve rates below 8% (must escalate to admin)

### Migration Safety

All existing role checks use named keys (e.g., `ROLE_LEVELS.admin`), not numeric values. Shifting numbers does not break existing logic.

---

## 2. Interest Rate Approval Flow

### New Table: `rate_change_requests`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| loanId | uuid | FK → loans |
| requestedRate | numeric(5,4) | Desired rate as decimal (e.g., 0.08 for 8%) |
| currentRate | numeric(5,4) | Rate at time of request |
| requestedBy | text | FK → user.id |
| requiredApproverRole | text | `supervisor` or `admin` — auto-determined by threshold |
| status | enum | `pending`, `approved`, `rejected` |
| reviewedBy | text | FK → user.id, nullable |
| reviewNote | text | Reason for approval/rejection |
| createdAt | timestamp | |
| reviewedAt | timestamp | nullable |

### Rate Thresholds

| Requested Rate | Who Can Set Freely | Who Must Approve |
|---------------|-------------------|-----------------|
| >= 10% | loanOfficer+ | No approval needed |
| 8% - <10% | supervisor+ | supervisor approves loan officer requests |
| < 8% | admin+ | admin approves supervisor/officer requests |

### Flow

1. Loan is created at default rate (10%) or any rate >= 10%
2. To lower the rate, user clicks "Request Rate Change" on loan detail page
3. System determines `requiredApproverRole` based on requested rate:
   - 8% to <10%: `supervisor`
   - <8%: `admin`
4. If the requesting user's role already meets the threshold, the change applies immediately (no request needed)
5. Otherwise, request is saved as `pending`
6. Approver sees pending requests on `/approvals` page (visible to supervisor+)
7. Approver reviews: approve or reject with a note
8. On approval: loan's `interestRate` is updated, audit log entry created
9. On rejection: requester sees rejection with reason on loan detail

### UI

- **Loan detail page:** "Request Rate Change" button (all roles)
- **`/approvals` page:** Table of pending/recent requests with approve/reject actions (supervisor+)
- **Sidebar:** "Approvals" link with badge count for pending requests (supervisor+)
- **Loan detail:** Status indicator when a pending rate change request exists

---

## 3. Loan Issuance Fee

### Schema Change

Add to `loans` table:

| Column | Type | Description |
|--------|------|-------------|
| issuanceFee | numeric(15,2) | Required, minimum 50,000 |

### Validation

- Client-side: required field, minimum value 50,000
- Server-side: reject if fee < 50,000 or missing

### Creation Flow

- New required input in loan creation form Step 1 (alongside principal, rate, start date)
- Label: "Issuance Fee" with helper text "Minimum 50,000"
- Displayed in Step 3 review summary

### Display & Reporting

- Loan detail page: fee shown alongside principal and rate
- POS receipt: fee as line item
- Income reporting: fees summed as line item in income totals alongside interest income
- Fee is charged separately — not deducted from principal

---

## 4. Loan Description Required

### Schema Change

Add to `loans` table:

| Column | Type | Description |
|--------|------|-------------|
| description | text | Required — purpose/details of the loan |

### Validation

- Client-side: required field, cannot be empty
- Server-side: reject if description is empty/whitespace

### Display

- Shown on loan detail page, POS receipt, and PDF receipt

---

## 5. POS Receipts

### Component: `<PosReceipt>`

Reusable React component rendering a narrow thermal-printer layout (80mm width).

### Receipt: Loan Issuance

- Business name/header
- Date, receipt number (format: `RCP-YYYYMMDD-XXXX`, generated client-side)
- Customer name, NIN
- Loan details: principal, interest rate, issuance fee, description
- Issued by (loan officer name)
- Footer

### Receipt: Payment Registration

- Business name/header
- Date, receipt number (format: `RCP-YYYYMMDD-XXXX`, generated client-side)
- Customer name, loan reference
- Payment amount, allocation (interest portion, principal portion)
- Outstanding balance after payment
- Deposit location (cash / bank / strong room)
- Recorded by (officer name)
- Footer

### Behavior

- After loan issuance completes: modal with POS receipt preview auto-opens
- After payment registration completes: same modal auto-opens
- Modal has "Print" button → `window.print()` with `@media print` CSS constraining to 80mm width
- Existing PDF receipt buttons remain as separate option on loan detail / payment views

---

## 6. Cash Management & Account Equation

### Concept

Track where money physically sits across three locations:
- **Cash** — on hand
- **Bank** — bank account
- **Strong Room** — office safe deposit

### Schema Changes

Add to `loans` table:

| Column | Type | Description |
|--------|------|-------------|
| disbursementSource | enum(`cash`, `bank`, `strong_room`) | Required — where the loan money was disbursed from |

Add to `payments` table:

| Column | Type | Description |
|--------|------|-------------|
| depositLocation | enum(`cash`, `bank`, `strong_room`) | Required — where the payment money was deposited |

### New Table: `fund_transfers`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| fromLocation | enum | `cash`, `bank`, `strong_room` |
| toLocation | enum | `cash`, `bank`, `strong_room` |
| amount | numeric(15,2) | Transfer amount |
| transferredBy | text | FK → user.id |
| note | text | Optional reason |
| createdAt | timestamp | |

### Payment Flow Change

- Payment form gets a new required dropdown: "Deposit Location" (Cash / Bank / Strong Room)
- Stored on the payment record

### Financial Statements

- **Balance sheet:** Asset breakdown by location (cash on hand, bank balance, strong room balance). Calculated by summing payment deposit locations + fund transfers - disbursements.
- **Income statement:** Interest income + fee income as separate line items
- **Accounting equation:** `Assets (Cash + Bank + Strong Room + Outstanding Loans) = Owner's Equity + Income`

### UI

- Deposit location dropdown on payment registration form
- Fund transfer page (admin+) for recording internal movements between locations
- Balance breakdown on dashboard showing amounts per location
- Income statement showing interest income + fee income

---

## Architecture Notes

- All new server actions follow existing pattern: role check → validate → mutate → audit log
- No Zod — TypeScript types for validation, manual checks in server actions
- All UI follows existing patterns (shadcn/ui components, react-hook-form)
- New enums created via Drizzle `pgEnum`
- Migrations generated via `drizzle-kit generate` and applied via `drizzle-kit push`
