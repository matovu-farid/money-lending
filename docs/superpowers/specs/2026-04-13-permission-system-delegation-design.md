# Permission-Based Authorization & Managing Supervisor Delegation

**Date:** 2026-04-13
**Status:** Draft

## Overview

Two-part change to the authorization system:

1. **Refactor from role-level checks to permission-based checks.** Every server action and UI guard checks a specific permission string instead of comparing role hierarchy levels. Roles become static bundles of permissions.
2. **Add a delegation system** that temporarily elevates a Supervisor to "Managing Supervisor" — granting admin-level operational permissions without changing their role. Designed for when the admin is away.

## Permission Catalog

Permissions are `resource:action` strings grouped by category.

### Operations

| Permission | Description |
|------------|-------------|
| `loan:create` | Create a new loan |
| `loan:read` | View loan details |
| `loan:update` | Edit loan details |
| `loan:disburse` | Activate a pending loan (mark as disbursed) |
| `loan:rollover` | Roll over a loan into a new one |
| `loan:settle` | Settle/close a loan |
| `customer:create` | Add a new customer |
| `customer:read` | View customer details |
| `customer:update` | Edit customer details |
| `payment:create` | Record a payment |
| `payment:read` | View payments |
| `payment:update` | Edit a payment |
| `payment:delete` | Delete a payment |
| `expense:create` | Record an expense |
| `expense:read` | View expenses |
| `income:create` | Record income |
| `income:read` | View income |
| `fund-transfer:create` | Create a fund transfer |
| `fund-transfer:read` | View fund transfers |
| `backdate:beyond-3-days` | Backdate transactions beyond 3 days |

### Approvals

| Permission | Description |
|------------|-------------|
| `rate-change:create` | Request a rate change |
| `rate-change:approve-standard` | Approve rate changes >= 8% |
| `rate-change:approve-low` | Approve rate changes < 8% |

### Capital / Creditors

| Permission | Description |
|------------|-------------|
| `creditor:read` | View creditors list and details |
| `creditor:create` | Add a new creditor |
| `creditor:update` | Edit creditor details |

### Reports & Insights

| Permission | Description |
|------------|-------------|
| `dashboard:read` | View KPI dashboard |
| `reports:read` | View reports |

### Administration

| Permission | Description |
|------------|-------------|
| `role:assign-loan-officer` | Assign loan officer role |
| `role:assign-supervisor` | Assign supervisor role |
| `role:assign-admin` | Assign admin role |
| `role:assign-super-admin` | Assign super admin role |
| `settings:read` | View system settings |
| `settings:update` | Modify system settings |
| `user:list` | View user list |
| `user:ban` | Ban a user |
| `user:impersonate` | Impersonate a user |
| `session:list` | View active sessions |
| `session:revoke` | Revoke a session |
| `session:delete` | Delete a session |

### Delegation

| Permission | Description |
|------------|-------------|
| `delegation:create` | Create a delegation (elevate a supervisor) |
| `delegation:revoke` | Revoke an active delegation |
| `delegation:read` | View delegation history |

## Role -> Permission Mapping

### Unassigned
No permissions.

### Loan Officer
- **Operations:** `loan:create`, `loan:read`, `loan:update`, `customer:create`, `customer:read`, `customer:update`, `payment:create`, `payment:read`, `payment:update`, `payment:delete`, `expense:create`, `expense:read`, `income:create`, `income:read`, `fund-transfer:create`, `fund-transfer:read`
- **Approvals:** `rate-change:create`
- **Reports:** `reports:read`

### Supervisor
Everything Loan Officer has, plus:
- **Operations:** `loan:disburse`, `loan:rollover`, `loan:settle`, `backdate:beyond-3-days`
- **Approvals:** `rate-change:approve-standard`
- **Capital:** `creditor:read`, `creditor:create`, `creditor:update`
- **Reports:** `dashboard:read`
- **Administration:** `role:assign-loan-officer`

### Admin
Everything Supervisor has, plus:
- **Approvals:** `rate-change:approve-low`
- **Administration:** `role:assign-supervisor`, `settings:read`, `settings:update`, `user:list`, `user:ban`, `user:impersonate`, `session:list`, `session:revoke`, `session:delete`
- **Delegation:** `delegation:create`, `delegation:revoke`, `delegation:read`

### Super Admin
Everything Admin has, plus:
- **Administration:** `role:assign-admin`, `role:assign-super-admin`

### Managing Supervisor (Elevated Set)
Applied on top of Supervisor permissions when an active delegation exists. Grants the Admin permission set **minus**:
- All `creditor:*` permissions
- All `role:*` permissions
- All `delegation:*` permissions

Net permissions gained by a delegated Supervisor:
- `rate-change:approve-low`
- `settings:read`, `settings:update`
- `user:list`, `user:ban`, `user:impersonate`
- `session:list`, `session:revoke`, `session:delete`

## Removed Permissions

The following were considered and intentionally excluded:
- **`loan:delete`** — Loans are immutable. No one can delete loans.
- **`user:delete`** — Too destructive. Removed from all roles including Super Admin.

## Delegation System

### Purpose
Temporarily elevate a Supervisor to Managing Supervisor when the admin is away, without changing their actual role.

### Database Schema

**Table: `delegations`**

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `userId` | text | FK -> user. The supervisor receiving elevation. |
| `delegatedBy` | text | FK -> user. The admin who created the delegation. |
| `createdAt` | timestamp | When delegation was activated |
| `revokedAt` | timestamp | Nullable. When delegation was revoked. Null = active. |
| `revokedBy` | text | Nullable. FK -> user. Who revoked it. |

### Rules
- Only users with `admin` or `superAdmin` role can create/revoke delegations
- Only users with `supervisor` role can receive a delegation
- A user can have at most one active delegation at a time (where `revokedAt IS NULL`)
- Revoking sets `revokedAt` and `revokedBy` — rows are never deleted (audit trail)
- Historical rows remain for full delegation timeline

### Audit Trail
The `delegations` table itself serves as the audit log:
- **Creation:** `delegatedBy`, `createdAt` record who elevated whom and when
- **Revocation:** `revokedBy`, `revokedAt` record who revoked and when
- **History:** All rows are preserved, giving a complete timeline per user

### UI (Admin Area)
- **Delegations section:** Shows active delegations and history log
- **Delegate button:** Next to supervisors in the user list
- **Revoke button:** Next to actively delegated supervisors
- **History view:** Who, delegated by whom, when, revoked by whom, when

## Authorization Resolution Flow

When `withAction({ permission: "some:permission" })` is called:

1. Get the user's role from session
2. Look up the base permission set for that role
3. Query for active delegation (`userId = user.id AND revokedAt IS NULL`)
4. If active delegation exists, merge the Managing Supervisor elevated permission set into the base set
5. Check if the required permission is in the effective set
6. Allow or deny

The delegation query should be cached in the auth session context to avoid a DB round-trip on every action.

## `withAction` Refactor

**Before:**
```ts
export const createLoanAction = withAction({
  minRole: "admin",
  action: async (session, input) => { ... }
})
```

**After:**
```ts
export const createLoanAction = withAction({
  permission: "loan:create",
  action: async (session, input) => { ... }
})
```

The `minRole` parameter is removed. The role hierarchy levels (0-4) remain only for the role assignment guard logic (can't assign a role at or above your own level).

## UI Authorization

### Sidebar
Sidebar items switch from role level comparison to permission checks. Example: Dashboard link shows if user has `dashboard:read` permission.

### Layout Guards
Page layouts (e.g., admin layout, dashboard layout) check for a relevant permission instead of a minimum role level.

### Client-Side Permission Set
The effective permission set is exposed to the client via the auth session, so UI components can conditionally render without extra API calls.

## Migration Notes

- The better-auth access control definitions in `permissions.ts` remain for compatibility but `withAction` no longer uses them for authorization decisions.
- The `getRequiredApproverRole()` function in rate change request actions is replaced by permission checks (`rate-change:approve-standard` vs `rate-change:approve-low`).
- After schema changes, `drizzle-kit push` must be run against both dev and production Neon databases.
