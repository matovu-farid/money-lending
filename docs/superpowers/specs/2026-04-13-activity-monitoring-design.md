# Activity Monitoring System Design

## Overview

A role-based activity monitoring system that lets supervisors and admins view what their subordinates have been doing in the system. Built on top of the existing `audit_log` table — no new data capture needed, only new viewing/querying infrastructure.

## Decisions

- **Mutations only** — no read/navigation logging. The existing audit log captures all entity mutations with before/after values.
- **Dynamic descriptions** — activity descriptions are formatted at render time from audit log fields, not stored as pre-formatted text.
- **Strict downward visibility** — admins see supervisors + loan officers; supervisors see loan officers only. No peer or self visibility.
- **Always-linkable** — activity entries link to the relevant entity page. If the entity is deleted or inaccessible, the link 404s naturally.
- **All entity types** — the activities page shows every entity type in the audit log (loans, payments, customers, creditors, fund transfers, rate changes, settlements, categories, transactions).
- **Table layout** — consistent with other list pages (payments, loans). Better for investigation/monitoring than a timeline feed.
- **Dashboard capped at 3** — replaces the existing infinite-scroll activity feed with a simple 3-item card linking to the full activities page.

## Data Layer

### Existing Schema (no changes)

The `audit_log` table already provides:

| Column | Purpose |
|--------|---------|
| `actorId` | Who performed the action (FK to `user.id`) |
| `action` | Action identifier (e.g. `loan.create`, `payment.delete`) |
| `entityType` | Entity kind (loan, payment, customer, etc.) |
| `entityId` | Specific entity ID (for generating links) |
| `beforeValue` | JSON snapshot of state before change |
| `afterValue` | JSON snapshot of state after change |
| `occurredAt` | Timestamp with timezone |

### New Index

Add `idx_audit_actor_id` on `audit_log.actorId` — the activities page filters by user frequently and this column is currently unindexed.

## Service Layer

### `activity.service.ts`

Single function: `getActivities(params)`

**Parameters:**
- `actorId?: string` — filter to a specific user
- `entityType?: string` — filter by entity type
- `dateFrom?: Date` / `dateTo?: Date` — date range filter
- `page: number` / `pageSize: number` — pagination (default 25)
- `viewerRole: string` — determines which actor roles are visible

**Query logic:**
1. Based on `viewerRole`, compute the set of visible roles (strict downward):
   - `superAdmin` / `admin` → `['supervisor', 'loanOfficer']`
   - `supervisor` → `['loanOfficer']`
2. Join `audit_log` with `user` on `actorId` to get actor name and role
3. Filter: `user.role IN visibleRoles`, plus optional actorId, entityType, dateFrom, dateTo
4. Order by `occurredAt DESC`
5. Return `{ items: ActivityItem[], total: number }`

**ActivityItem shape:**

```typescript
{
  id: string
  actorName: string
  actorRole: string
  action: string
  entityType: string
  entityId: string
  description: string    // dynamically formatted
  href: string | null    // link to entity page
  occurredAt: Date
}
```

### Description Formatter

Pure function: `formatActivityDescription(action, entityType, beforeValue, afterValue) → string`

Maps audit log entries to human-readable text. Extended from the existing dashboard service logic to cover all entity types:

- `loan.create` → "Loan issued to {customerName} — UGX {amount}"
- `payment.create` → "Payment received — UGX {amount}"
- `customer.create` → "Customer {fullName} created"
- `customer.update` → "Customer {fullName} updated"
- `creditor.create` → "Creditor {name} added"
- `fund_transfer.create` → "Fund transfer — UGX {amount}"
- `loan.rate_change.approved` → "Rate change approved for loan #{shortId}"
- `loan.settle_with_collateral` → "Loan settled with collateral"
- Fallback: `"{entityType} {action}"`

### Link Generator

Pure function: `getActivityHref(entityType, entityId, afterValue) → string | null`

- `loan` → `/loans/{entityId}`
- `payment` → `/loans/{loanId}` (loanId from afterValue)
- `customer` → `/customers/{entityId}`
- `creditor` → `/creditors/{entityId}`
- Others → `null` (no dedicated detail page)

## Server Actions

### `activity.actions.ts`

```typescript
export const getActivitiesAction = withAction({
  permission: "activity:read",
  effect: (session, input) => getActivities({ ...input, viewerRole: session.user.role }),
})
```

### Dashboard Action Update

Simplify `getRecentActivityAction` in `dashboard.actions.ts` to call the same `getActivities` service with `pageSize: 3` and no filters. For loan officers (no `activity:read` permission), show their own recent actions instead.

## Activities Page

### Route

`/src/app/(app)/activities/page.tsx` — client component.

### Permission Gate

Requires `activity:read` permission. Loan officers and unassigned users cannot access.

### Filter Bar

Uses existing `FilterPanel` component pattern. All filters sync to URL search params via `useUrlFilters`.

| Filter | Type | Options |
|--------|------|---------|
| User | Searchable select | Users with roles below the viewer. Shows name + role badge. |
| Entity Type | Select | All, loan, payment, customer, creditor, fund_transfer, rate_change, settlement, category, transaction |
| Date From | Date picker | With presets: Today, Last 7 days, Last 30 days |
| Date To | Date picker | Defaults to today |

### Table

Uses existing `ResponsiveTable` component.

| Column | Content |
|--------|---------|
| Time | Monospace. Relative for today ("10:34 AM"), date+time for older ("Apr 12, 9:15 AM") |
| User | Actor name |
| Action | Color-coded badge (e.g. `loan.create` in indigo, `payment.create` in green) |
| Entity | Entity type + short ID or name |
| Details | Human-readable description |
| Link | External link icon → entity page |

Sorted by `occurredAt DESC`. Standard numbered pagination (not infinite scroll).

### Empty States

- No matching results: "No activities found. Try adjusting your filters."
- No subordinate activity at all: "No team activity recorded yet."

### Action Badge Colors

| Entity Type | Badge Color |
|-------------|-------------|
| loan | Indigo |
| payment | Green |
| customer | Amber |
| creditor | Blue |
| fund_transfer | Purple |
| rate_change | Rose |
| settlement | Orange |
| Other | Gray |

## Dashboard Widget Changes

Replace the existing infinite-scroll activity feed in `dashboard/page.tsx`:

**Before:** Card with `useInfiniteQuery`, intersection observer, expand/collapse detail, unlimited scrolling.

**After:**
- Card with "Recent Activity" header and "View all →" link to `/activities`
- Exactly 3 items, no pagination, no scroll
- Each item: icon + description + relative time + actor name + link icon
- No expand/collapse (keep it simple — the activities page is for deep dives)
- Loading: 3 skeleton rows
- Empty: "No recent activity"

For users with `activity:read` (supervisor+): shows subordinate activity using the same `getActivities` service with role-based filtering.
For loan officers (no `activity:read`): shows all recent audit log entries for loans and payments (same as current behavior — not role-filtered, since this is general business activity, not a monitoring tool).

## Navigation

Add "Activities" item to the sidebar, visible when user has `activity:read` permission. Positioned after the main operational pages (loans, payments, customers) and before admin/reports.

Icon: `Activity` from lucide-react.

## Permissions

Add `activity:read` to the permission map in `permissions.ts`:

| Role | Has `activity:read` |
|------|---------------------|
| superAdmin | Yes |
| admin | Yes |
| supervisor | Yes |
| loanOfficer | No |
| unassigned | No |

## Change Summary

| Change | Files |
|--------|-------|
| New index on `actorId` | `src/lib/db/schema/audit.ts` |
| Activity service | `src/services/activity.service.ts` |
| Activity action | `src/actions/activity.actions.ts` |
| Activities page | `src/app/(app)/activities/page.tsx`, `ActivitiesClient.tsx` |
| Permission update | `src/lib/permissions.ts` |
| Dashboard simplification | `src/app/(app)/dashboard/page.tsx` |
| Sidebar nav item | Sidebar/layout component |
| Dashboard action update | `src/actions/dashboard.actions.ts` |
