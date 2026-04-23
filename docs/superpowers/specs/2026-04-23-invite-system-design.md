# Invite System Design

## Overview

Admin-driven invite flow that allows Admins and Super Admins to invite users by email with a pre-assigned role. Invitees receive an email, click a link, set their password, and land in the app with their role already assigned. No approval step, no email verification — the admin's invite is the trust signal.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Role assignment | At invite time | Admin already knows the person's role; eliminates the unassigned → assign step |
| Acceptance UX | Set password only | Name and email known from invite; minimum friction, one screen |
| Who can invite | Admins + Super Admins | Follows existing hierarchy — can only invite to roles strictly below your own |
| Invite expiry | 7 days, fixed | Keeps stale links from floating around; admin can resend easily |
| Invite management | Full admin UI | Pending/expired/accepted/revoked list with revoke and resend actions |
| Duplicate emails | Rejected | If already registered, admin assigns role via existing user management |
| Auth approach | Hybrid — custom table + Better Auth signUp | Organization plugin is multi-tenant overkill; custom invites with battle-tested account creation |

## Data Model

New `invitations` table in Drizzle schema:

```
invitations {
  id            text        PK, generated
  email         text        invitee's email
  name          text        invitee's display name (set by admin)
  role          text        role to assign (loanOfficer, supervisor, admin)
  invitedBy     text        FK → user.id (who sent the invite)
  token         text        unique, SHA-256 hash of the raw token
  status        text        'pending' | 'accepted' | 'expired' | 'revoked'
  expiresAt     timestamp   7 days from creation
  createdAt     timestamp   when the invite was sent
  acceptedAt    timestamp   nullable, when they accepted
}
```

Constraints:
- Unique index on `(email, status)` where status = 'pending' — only one pending invite per email
- Index on `token` for fast lookup
- Foreign key on `invitedBy` → `user.id`

## Invite Flow

### Sending an Invite

1. Admin/Super Admin opens admin panel → "Invitations" tab
2. Fills in: email, name, role (dropdown filtered to roles below their own)
3. Server action `createInvite()` validates:
   - Email not already registered in `user` table
   - No pending invite exists for that email
   - Inviter has `user:invite` permission
   - Target role is strictly below inviter's role
4. Generates 32-byte random token via `crypto.randomBytes()`
5. Stores invitation row with SHA-256 hashed token
6. Sends invite email via Resend using new `invite-user.tsx` template
7. Returns success → toast "Invitation sent to {email}"

### Accepting an Invite

1. Invitee clicks link → `/accept-invite?token=<raw_token>`
2. Page hashes the URL token with SHA-256, looks up invitation by hashed token
3. Validates: status is `pending`, not past `expiresAt`, not revoked
4. Renders minimal page: "Welcome, {name}" with password + confirm password fields
5. On submit, server action `acceptInvite()`:
   - Re-validates token (guard against race conditions)
   - Creates account via Better Auth `signUp.email()` with `emailVerified: true`
   - Assigns the role from the invitation to the new user
   - Updates invitation: status → `accepted`, sets `acceptedAt`
6. Auto sign-in → redirect to app dashboard

### Invalid/Expired Link

- Shows error page: "This invite has expired or is no longer valid. Contact your administrator."

## Admin Management UI

Located in the existing admin panel as a new "Invitations" tab/section.

### Invite Form
- Email input, Name input, Role dropdown (filtered by inviter's hierarchy)
- "Send Invite" button

### Invitations Table
Columns: Name, Email, Role, Status (badge), Sent by, Sent date, Expires date, Actions

Actions per status:
- **Pending** → Revoke, Resend
- **Expired** → Resend (creates a fresh invite with new token and expiry)
- **Accepted** → No actions (history only)
- **Revoked** → No actions

### Filtering
Tabs or filter by status: All / Pending / Accepted / Expired / Revoked

## Server Actions

All gated by `withAction()` using the `user:invite` permission.

| Action | Description |
|---|---|
| `createInvite({ email, name, role })` | Validates, creates invitation, sends email |
| `revokeInvite({ invitationId })` | Sets status to `revoked` |
| `resendInvite({ invitationId })` | Generates fresh token, resets expiry, re-sends email |
| `acceptInvite({ token, password })` | Creates account, assigns role, marks accepted |
| `getInvitations(filters?)` | Lists invitations with optional status filter |

## Permission Changes

Add `user:invite` to the permissions map:
- **Admin** → granted
- **Super Admin** → granted
- All other roles → not granted

## Email Template

New `invite-user.tsx` React Email template following existing patterns (`verify-email.tsx`, `reset-password.tsx`):
- Header: app branding
- Body: "{inviterName} has invited you to join {appName} as a {role}"
- Prominent "Join Now" CTA button with the invite link
- Footer: "This link expires in 7 days"

## Security

- **Token generation:** `crypto.randomBytes(32)` → hex string for the URL, SHA-256 hash stored in DB
- **Token comparison:** Timing-safe via hash comparison (lookup by hash, not by raw token)
- **Role hierarchy enforcement:** Server-side check that inviter's role is strictly above the target role
- **Expired invite cleanup:** Expiry checked at acceptance time; no background job needed
- **Race conditions:** Re-validate token status inside `acceptInvite()` before creating the account
- **Revocation while on set-password page:** Submission fails gracefully with error message

## Edge Cases

| Scenario | Behavior |
|---|---|
| Email already registered | Reject with "This user already has an account" |
| Pending invite exists for email | Reject with "A pending invite already exists — use resend instead" |
| Invite expired, user clicks link | Error page with message to contact admin |
| Invite revoked, user clicks link | Error page with message to contact admin |
| Admin revokes while invitee is on form | Submit fails with "This invite is no longer valid" |
| Resend on expired invite | New token, new 7-day expiry, fresh email |
| Admin tries to invite role above their own | Server rejects, error message shown |

## Testing

Cypress E2E tests covering:
- Send invite (happy path)
- Accept invite and set password
- Expired invite shows error
- Revoked invite shows error
- Resend generates fresh invite
- Role hierarchy enforcement (admin can't invite admin)
- Duplicate email rejection
- Duplicate pending invite rejection
- Admin management table: filter by status, revoke, resend actions
