# Invite System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Admins and Super Admins to invite users by email with a pre-assigned role; invitees click a link, set their password, and land in the app with their role ready.

**Architecture:** Custom `invitations` Drizzle table with hashed tokens. Server actions for CRUD + acceptance. Invite acceptance creates a Better Auth account via `signUp.email()` with `emailVerified: true` and assigns the role. Admin UI as a new section on the existing admin page. TanStack DB collection for live invite management.

**Tech Stack:** Drizzle ORM, Better Auth, Resend + React Email, TanStack DB, shadcn/ui, Cypress

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/db/schema/invitations.ts` | Drizzle table + relations |
| `src/lib/db/schema/index.ts` | Re-export invitations schema |
| `src/types/common.ts` | Add `"user:invite"` permission |
| `src/lib/permissions.ts` | Wire `user:invite` into admin + superAdmin |
| `src/services/invitation.service.ts` | DB operations: create, revoke, resend, accept, list |
| `src/actions/invitation.actions.ts` | Server actions wrapping service layer |
| `src/lib/emails/invite-user.tsx` | React Email invite template |
| `src/lib/emails/index.ts` | Re-export invite template |
| `src/collections/invitations.ts` | TanStack DB collection |
| `src/collections/index.ts` | Re-export invitation collection |
| `src/lib/query-keys.ts` | Add invitations query key |
| `src/app/(app)/admin/page.tsx` | Add Invitations section |
| `src/app/(auth)/accept-invite/page.tsx` | Accept-invite page (set password) |
| `src/app/(auth)/accept-invite/actions.ts` | Server actions for token validation + acceptance |
| `cypress.config.ts` | Add invite-related DB tasks |
| `cypress/e2e/invitations.cy.ts` | E2E tests |

---

### Task 1: Schema — `invitations` Table

**Files:**
- Create: `src/lib/db/schema/invitations.ts`
- Modify: `src/lib/db/schema/index.ts`

- [ ] **Step 1: Create the invitations schema file**

```typescript
// src/lib/db/schema/invitations.ts
import { pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { user } from "./auth"

export const invitations = pgTable(
  "invitation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
  },
  (table) => [
    index("invitation_email_idx").on(table.email),
    index("invitation_token_idx").on(table.token),
    index("invitation_status_idx").on(table.status),
    uniqueIndex("invitation_email_pending_idx")
      .on(table.email)
      .where(sql`status = 'pending'`),
  ],
)

export const invitationRelations = relations(invitations, ({ one }) => ({
  inviter: one(user, {
    fields: [invitations.invitedBy],
    references: [user.id],
  }),
}))
```

- [ ] **Step 2: Add export to schema index**

Add this line to `src/lib/db/schema/index.ts`:

```typescript
export * from "./invitations"
```

- [ ] **Step 3: Push schema to dev database**

Run: `npx drizzle-kit push`
Expected: Table `invitation` created with all columns and indexes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema/invitations.ts src/lib/db/schema/index.ts
git commit -m "feat: add invitations table schema"
```

---

### Task 2: Permissions — Add `user:invite`

**Files:**
- Modify: `src/types/common.ts`
- Modify: `src/lib/permissions.ts`

- [ ] **Step 1: Add `user:invite` to the Permission type**

In `src/types/common.ts`, add `"user:invite"` to the `Permission` type union. Place it after the existing `"user:impersonate"` line:

```typescript
  | "user:list" | "user:ban" | "user:impersonate" | "user:invite"
```

- [ ] **Step 2: Add `user:invite` to the PERMISSIONS array**

In `src/lib/permissions.ts`, add `"user:invite"` to the `PERMISSIONS` array after `"user:impersonate"`:

```typescript
  "user:list", "user:ban", "user:impersonate", "user:invite",
```

- [ ] **Step 3: Add `user:invite` to admin and superAdmin permission sets**

In `src/lib/permissions.ts`, add `"user:invite"` to `adminExtras`:

```typescript
const adminExtras: Permission[] = [
  "rate-change:approve-low",
  "role:assign-supervisor",
  "creditor:read", "creditor:create", "creditor:update",
  "settings:read", "settings:update",
  "user:list", "user:ban", "user:impersonate", "user:invite",
  "session:list", "session:revoke", "session:delete",
  "delegation:create", "delegation:revoke", "delegation:read",
]
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/common.ts src/lib/permissions.ts
git commit -m "feat: add user:invite permission for admin and superAdmin"
```

---

### Task 3: Email Template — Invite User

**Files:**
- Create: `src/lib/emails/invite-user.tsx`
- Modify: `src/lib/emails/index.ts`

- [ ] **Step 1: Create the invite email template**

```tsx
// src/lib/emails/invite-user.tsx
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components"

type InviteUserProps = {
  url: string
  inviterName: string
  role: string
  inviteeName: string
}

const ROLE_LABELS: Record<string, string> = {
  loanOfficer: "Loan Officer",
  supervisor: "Supervisor",
  admin: "Admin",
  superAdmin: "Super Admin",
}

export function InviteUserTemplate({ url, inviterName, role, inviteeName }: InviteUserProps) {
  const roleLabel = ROLE_LABELS[role] ?? role

  return (
    <Html>
      <Head />
      <Preview>{inviterName} invited you to join Lending Manager</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={headerText}>Lending Manager</Text>
          </Section>
          <Section style={content}>
            <Heading style={heading}>You&apos;re invited!</Heading>
            <Text style={paragraph}>
              Hi {inviteeName}, {inviterName} has invited you to join Lending Manager
              as a <strong>{roleLabel}</strong>.
            </Text>
            <Text style={paragraph}>
              Click the button below to set your password and get started.
            </Text>
            <Section style={buttonSection}>
              <Button style={button} href={url}>
                Join Now
              </Button>
            </Section>
            <Text style={smallText}>
              This invitation expires in 7 days.
            </Text>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            If you were not expecting this invitation, you can safely ignore this email.
          </Text>
          <Text style={copyright}>
            &copy; {new Date().getFullYear()} Lending Manager
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default InviteUserTemplate

const body: React.CSSProperties = {
  backgroundColor: "#f4f4f7",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  margin: "0",
  padding: "0",
}

const container: React.CSSProperties = {
  maxWidth: "560px",
  margin: "0 auto",
  padding: "20px 0 48px",
}

const header: React.CSSProperties = {
  backgroundColor: "#1e293b",
  borderRadius: "8px 8px 0 0",
  padding: "24px 32px",
  textAlign: "center" as const,
}

const headerText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: "700",
  margin: "0",
  letterSpacing: "-0.3px",
}

const content: React.CSSProperties = {
  backgroundColor: "#ffffff",
  padding: "32px 32px 24px",
}

const heading: React.CSSProperties = {
  color: "#1e293b",
  fontSize: "24px",
  fontWeight: "700",
  margin: "0 0 16px",
  letterSpacing: "-0.3px",
}

const paragraph: React.CSSProperties = {
  color: "#475569",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 24px",
}

const buttonSection: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "0 0 24px",
}

const button: React.CSSProperties = {
  backgroundColor: "#4f46e5",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: "600",
  lineHeight: "1",
  padding: "14px 32px",
  textDecoration: "none",
  textAlign: "center" as const,
}

const smallText: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "12px",
  lineHeight: "20px",
  margin: "0",
}

const hr: React.CSSProperties = {
  borderColor: "#e2e8f0",
  margin: "0",
}

const footer: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "12px",
  lineHeight: "20px",
  textAlign: "center" as const,
  padding: "16px 32px 0",
}

const copyright: React.CSSProperties = {
  color: "#cbd5e1",
  fontSize: "11px",
  textAlign: "center" as const,
  padding: "8px 32px 0",
}
```

- [ ] **Step 2: Add export to emails index**

Add this line to `src/lib/emails/index.ts`:

```typescript
export { InviteUserTemplate } from "./invite-user"
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/emails/invite-user.tsx src/lib/emails/index.ts
git commit -m "feat: add invite user email template"
```

---

### Task 4: Service Layer — Invitation Business Logic

**Files:**
- Create: `src/services/invitation.service.ts`

- [ ] **Step 1: Create the invitation service**

```typescript
// src/services/invitation.service.ts
import crypto from "crypto"
import { db } from "@/lib/db"
import { invitations } from "@/lib/db/schema/invitations"
import { user } from "@/lib/db/schema/auth"
import { eq, and, desc, sql } from "drizzle-orm"
import { Resend } from "resend"
import { InviteUserTemplate } from "@/lib/emails"
import type { UserRole } from "@/types"

const resend = new Resend(process.env.RESEND_API_KEY)
const emailFrom = process.env.EMAIL_FROM || "Lending Manager <noreply@fidexa.org>"
const isTest = process.env.NODE_ENV === "test" || process.env.CYPRESS === "true"

// In-memory store for test mode (same pattern as pendingVerifications in auth.ts)
export const pendingInviteUrls = new Map<string, string>()

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function generateToken(): { raw: string; hashed: string } {
  const raw = crypto.randomBytes(32).toString("hex")
  return { raw, hashed: hashToken(raw) }
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000"
}

export async function createInvitation(input: {
  email: string
  name: string
  role: UserRole
  invitedById: string
  inviterName: string
}) {
  // Check if email is already registered
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.email))
    .limit(1)

  if (existingUser) {
    throw new Error("This user already has an account")
  }

  // Check for existing pending invitation
  const [existingInvite] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.email, input.email), eq(invitations.status, "pending")))
    .limit(1)

  if (existingInvite) {
    throw new Error("A pending invite already exists for this email — use resend instead")
  }

  const { raw, hashed } = generateToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  const [row] = await db
    .insert(invitations)
    .values({
      email: input.email,
      name: input.name,
      role: input.role,
      invitedBy: input.invitedById,
      token: hashed,
      status: "pending",
      expiresAt,
    })
    .returning()

  const inviteUrl = `${getBaseUrl()}/accept-invite?token=${raw}`

  if (isTest) {
    pendingInviteUrls.set(input.email, inviteUrl)
  } else {
    await resend.emails.send({
      from: emailFrom,
      to: input.email,
      subject: `${input.inviterName} invited you to join Lending Manager`,
      react: InviteUserTemplate({
        url: inviteUrl,
        inviterName: input.inviterName,
        role: input.role,
        inviteeName: input.name,
      }),
    })
  }

  return row
}

export async function revokeInvitation(invitationId: string) {
  const [row] = await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(and(eq(invitations.id, invitationId), eq(invitations.status, "pending")))
    .returning()

  if (!row) {
    throw new Error("Pending invitation not found")
  }

  return row
}

export async function resendInvitation(invitationId: string, inviterName: string) {
  // Get the existing invitation
  const [existing] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.id, invitationId))
    .limit(1)

  if (!existing) {
    throw new Error("Invitation not found")
  }

  if (existing.status !== "pending" && existing.status !== "expired") {
    throw new Error("Can only resend pending or expired invitations")
  }

  const { raw, hashed } = generateToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const [row] = await db
    .update(invitations)
    .set({ token: hashed, expiresAt, status: "pending" })
    .where(eq(invitations.id, invitationId))
    .returning()

  const inviteUrl = `${getBaseUrl()}/accept-invite?token=${raw}`

  if (isTest) {
    pendingInviteUrls.set(existing.email, inviteUrl)
  } else {
    await resend.emails.send({
      from: emailFrom,
      to: existing.email,
      subject: `${inviterName} invited you to join Lending Manager`,
      react: InviteUserTemplate({
        url: inviteUrl,
        inviterName,
        role: existing.role,
        inviteeName: existing.name,
      }),
    })
  }

  return row
}

export async function validateInviteToken(rawToken: string) {
  const hashed = hashToken(rawToken)

  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, hashed))
    .limit(1)

  if (!invitation) {
    return { valid: false as const, error: "Invalid invitation link" }
  }

  if (invitation.status === "revoked") {
    return { valid: false as const, error: "This invitation has been revoked" }
  }

  if (invitation.status === "accepted") {
    return { valid: false as const, error: "This invitation has already been used" }
  }

  if (invitation.expiresAt < new Date()) {
    // Mark as expired
    await db
      .update(invitations)
      .set({ status: "expired" })
      .where(eq(invitations.id, invitation.id))

    return { valid: false as const, error: "This invitation has expired" }
  }

  if (invitation.status !== "pending") {
    return { valid: false as const, error: "This invitation is no longer valid" }
  }

  return { valid: true as const, invitation }
}

export async function acceptInvitation(rawToken: string, password: string) {
  const result = await validateInviteToken(rawToken)

  if (!result.valid) {
    throw new Error(result.error)
  }

  const { invitation } = result

  // Mark invitation as accepted
  await db
    .update(invitations)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(invitations.id, invitation.id))

  return {
    email: invitation.email,
    name: invitation.name,
    role: invitation.role as UserRole,
  }
}

export async function listInvitations(statusFilter?: string) {
  const baseQuery = db
    .select({
      id: invitations.id,
      email: invitations.email,
      name: invitations.name,
      role: invitations.role,
      status: invitations.status,
      invitedBy: invitations.invitedBy,
      inviterName: user.name,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      acceptedAt: invitations.acceptedAt,
    })
    .from(invitations)
    .leftJoin(user, eq(invitations.invitedBy, user.id))
    .orderBy(desc(invitations.createdAt))
    .limit(200)

  if (statusFilter && statusFilter !== "all") {
    return baseQuery.where(eq(invitations.status, statusFilter))
  }

  return baseQuery
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/invitation.service.ts
git commit -m "feat: add invitation service with create, revoke, resend, accept, list"
```

---

### Task 5: Server Actions — Invitation Actions

**Files:**
- Create: `src/actions/invitation.actions.ts`

- [ ] **Step 1: Create invitation server actions**

```typescript
// src/actions/invitation.actions.ts
"use server"

import { withAction } from "@/lib/with-action"
import { revalidatePath } from "next/cache"
import { getUserRole } from "@/lib/action-utils"
import { ROLE_LEVELS, type UserRole } from "@/types"
import {
  createInvitation,
  revokeInvitation,
  resendInvitation,
  listInvitations,
} from "@/services/invitation.service"

export const createInviteAction = withAction<
  { email: string; name: string; role: UserRole },
  any
>({
  permission: "user:invite",
  forbiddenMessage: "Only admins can send invitations",
  action: async (session, input) => {
    if (!input.email?.trim()) return { error: "Email is required" }
    if (!input.name?.trim()) return { error: "Name is required" }
    if (!input.role) return { error: "Role is required" }

    // Enforce hierarchy: can only invite to roles below your own
    const actorRole = getUserRole(session)
    const actorLevel = ROLE_LEVELS[actorRole] ?? 0
    const targetLevel = ROLE_LEVELS[input.role] ?? 0

    if (targetLevel >= actorLevel) {
      return { error: "Cannot invite to a role at or above your own level" }
    }

    try {
      const data = await createInvitation({
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        role: input.role,
        invitedById: session.user.id,
        inviterName: session.user.name ?? "Admin",
      })
      revalidatePath("/admin")
      return { data }
    } catch (e: any) {
      return { error: e.message ?? "Failed to send invitation" }
    }
  },
})

export const revokeInviteAction = withAction<{ invitationId: string }, any>({
  permission: "user:invite",
  forbiddenMessage: "Only admins can revoke invitations",
  action: async (_session, input) => {
    if (!input.invitationId?.trim()) return { error: "Invitation ID is required" }

    try {
      const data = await revokeInvitation(input.invitationId)
      revalidatePath("/admin")
      return { data }
    } catch (e: any) {
      return { error: e.message ?? "Failed to revoke invitation" }
    }
  },
})

export const resendInviteAction = withAction<{ invitationId: string }, any>({
  permission: "user:invite",
  forbiddenMessage: "Only admins can resend invitations",
  action: async (session, input) => {
    if (!input.invitationId?.trim()) return { error: "Invitation ID is required" }

    try {
      const data = await resendInvitation(
        input.invitationId,
        session.user.name ?? "Admin",
      )
      revalidatePath("/admin")
      return { data }
    } catch (e: any) {
      return { error: e.message ?? "Failed to resend invitation" }
    }
  },
})

export const listInvitationsAction = withAction({
  permission: "user:invite",
  action: async (_session) => {
    try {
      const data = await listInvitations()
      return { data }
    } catch {
      return { error: "Failed to load invitations" }
    }
  },
})
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/actions/invitation.actions.ts
git commit -m "feat: add invitation server actions"
```

---

### Task 6: TanStack DB Collection — Invitations

**Files:**
- Create: `src/collections/invitations.ts`
- Modify: `src/collections/index.ts`
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add invitations query key**

In `src/lib/query-keys.ts`, add after the `delegations` block:

```typescript
  // ── Invitations ──────────────────────────────────────────────────────
  invitations: {
    all: ["invitations"] as const,
  },
```

- [ ] **Step 2: Create invitations collection**

```typescript
// src/collections/invitations.ts
"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import {
  listInvitationsAction,
  createInviteAction,
  revokeInviteAction,
} from "@/actions/invitation.actions"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { UserRole } from "@/types"

export interface InvitationRow {
  id: string
  email: string
  name: string
  role: string
  status: string
  invitedBy: string
  inviterName: string | null
  expiresAt: Date
  createdAt: Date
  acceptedAt: Date | null
}

export const invitationCollection = createCollection(
  queryCollectionOptions<InvitationRow>({
    queryKey: [...queryKeys.invitations.all],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<InvitationRow>> => {
      const result = await listInvitationsAction()
      if ("error" in result) {
        throw new Error(result.error)
      }
      return result.data
    },
    getKey: (invitation) => invitation.id,
    onInsert: async ({ transaction }) => {
      const { modified } = transaction.mutations[0]
      const result = await createInviteAction({
        email: modified.email,
        name: modified.name,
        role: modified.role as UserRole,
      })
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
    onDelete: async ({ transaction }) => {
      const { original } = transaction.mutations[0]
      const result = await revokeInviteAction({ invitationId: original.id })
      if ("error" in result) {
        throw new Error(result.error)
      }
    },
  }),
)
```

- [ ] **Step 3: Add export to collections index**

Add to `src/collections/index.ts`:

```typescript
export { invitationCollection, type InvitationRow } from "./invitations"
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/collections/invitations.ts src/collections/index.ts src/lib/query-keys.ts
git commit -m "feat: add invitations TanStack DB collection"
```

---

### Task 7: Accept Invite Page

**Files:**
- Create: `src/app/(auth)/accept-invite/actions.ts`
- Create: `src/app/(auth)/accept-invite/page.tsx`

- [ ] **Step 1: Create the accept-invite server actions**

```typescript
// src/app/(auth)/accept-invite/actions.ts
"use server"

import { validateInviteToken, acceptInvitation } from "@/services/invitation.service"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { db } from "@/lib/db"
import { eq } from "drizzle-orm"
import { user } from "@/lib/db/schema/auth"

export async function getInviteDetails(token: string) {
  if (!token) return { error: "No invitation token provided" }

  const result = await validateInviteToken(token)
  if (!result.valid) {
    return { error: result.error }
  }

  return {
    data: {
      name: result.invitation.name,
      email: result.invitation.email,
      role: result.invitation.role,
    },
  }
}

export async function acceptInviteAndCreateAccount(token: string, password: string) {
  if (!token) return { error: "No invitation token provided" }
  if (!password || password.length < 8) return { error: "Password must be at least 8 characters" }

  try {
    const { email, name, role } = await acceptInvitation(token, password)

    // Create account via Better Auth with emailVerified: true
    const signUpResult = await auth.api.signUpEmail({
      body: { email, password, name },
      headers: await headers(),
    })

    if (!signUpResult?.user?.id) {
      return { error: "Failed to create account" }
    }

    // Set role and mark email as verified
    await db
      .update(user)
      .set({ role, emailVerified: true })
      .where(eq(user.id, signUpResult.user.id))

    return { data: { success: true } }
  } catch (e: any) {
    return { error: e.message ?? "Failed to accept invitation" }
  }
}
```

- [ ] **Step 2: Create the accept-invite page**

```tsx
// src/app/(auth)/accept-invite/page.tsx
"use client"

import { useState, useEffect, useTransition } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { signIn } from "@/lib/auth-client"
import { getInviteDetails, acceptInviteAndCreateAccount } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const ROLE_LABELS: Record<string, string> = {
  loanOfficer: "Loan Officer",
  supervisor: "Supervisor",
  admin: "Admin",
  superAdmin: "Super Admin",
}

interface SetPasswordForm {
  password: string
  confirmPassword: string
}

export default function AcceptInvitePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get("token") ?? ""

  const [inviteData, setInviteData] = useState<{ name: string; email: string; role: string } | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SetPasswordForm>({
    defaultValues: { password: "", confirmPassword: "" },
  })

  useEffect(() => {
    if (!token) {
      setPageError("No invitation token provided")
      setLoading(false)
      return
    }

    getInviteDetails(token).then((result) => {
      if ("error" in result) {
        setPageError(result.error!)
      } else {
        setInviteData(result.data)
      }
      setLoading(false)
    })
  }, [token])

  function onSubmit(data: SetPasswordForm) {
    if (data.password !== data.confirmPassword) {
      setError("confirmPassword", { message: "Passwords do not match." })
      return
    }

    startTransition(async () => {
      const result = await acceptInviteAndCreateAccount(token, data.password)

      if ("error" in result) {
        setError("root", { message: result.error })
        return
      }

      // Sign in with the new credentials
      const signInResult = await signIn.email({
        email: inviteData!.email,
        password: data.password,
      })

      if (signInResult.error) {
        setError("root", { message: "Account created but sign-in failed. Please go to the login page." })
        return
      }

      document.cookie = "has_account=1; path=/; max-age=315360000; SameSite=Lax"
      router.push("/")
      router.refresh()
    })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (pageError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Invitation Invalid</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{pageError}</p>
          <p className="text-sm text-muted-foreground mt-4">
            Contact your administrator for a new invitation.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome, {inviteData!.name}</CardTitle>
        <CardDescription>
          Set your password to join as {ROLE_LABELS[inviteData!.role] ?? inviteData!.role}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={inviteData!.email} disabled />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="new-password"
                className="pr-10 placeholder:text-2xl placeholder:leading-[0] focus:placeholder:text-transparent"
                disabled={isPending}
                {...register("password", {
                  required: "Password is required",
                  minLength: { value: 8, message: "Password must be at least 8 characters" },
                  maxLength: { value: 128, message: "Password is too long (max 128 characters)" },
                })}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((prev) => !prev)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="new-password"
                className="pr-10 placeholder:text-2xl placeholder:leading-[0] focus:placeholder:text-transparent"
                disabled={isPending}
                {...register("confirmPassword", {
                  required: "Please confirm your password",
                })}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                tabIndex={-1}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>

          {errors.root && (
            <div className="text-sm rounded-md px-3 py-2 bg-destructive/10 text-destructive">
              <p>{errors.root.message}</p>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin h-4 w-4" />
                Setting up your account...
              </>
            ) : (
              "Set Password & Join"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(auth\)/accept-invite/actions.ts src/app/\(auth\)/accept-invite/page.tsx
git commit -m "feat: add accept-invite page with set password flow"
```

---

### Task 8: Admin UI — Invitations Section

**Files:**
- Modify: `src/app/(app)/admin/page.tsx`

- [ ] **Step 1: Add invitation imports and state to admin page**

Add these imports at the top of `src/app/(app)/admin/page.tsx`:

```typescript
import { invitationCollection, type InvitationRow } from "@/collections"
import { resendInviteAction } from "@/actions/invitation.actions"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
```

- [ ] **Step 2: Add invite form and invitations table to AdminContent**

Add after the delegations section (before the final closing `</div>` of `AdminContent`), a new section gated by `has("user:invite")`:

```tsx
      {has("user:invite") && (
        <InvitationsSection actorRole={actorRole} session={session} />
      )}
```

- [ ] **Step 3: Create the InvitationsSection component**

Add this component at the bottom of the same file (before `export default`):

```tsx
function InvitationsSection({
  actorRole,
  session,
}: {
  actorRole: UserRole
  session: ReturnType<typeof useSession>["data"]
}) {
  const [email, setEmail] = useState("")
  const [inviteeName, setInviteeName] = useState("")
  const [inviteRole, setInviteRole] = useState<UserRole | "">("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [isSending, setIsSending] = useState(false)

  const roleOptions = getRoleOptions(actorRole)

  const { data: allInvitations = [] } = useLiveSuspenseQuery((q) =>
    q.from({ i: invitationCollection }).select(({ i }) => i)
  )

  const filteredInvitations =
    statusFilter === "all"
      ? allInvitations
      : allInvitations.filter((inv) => inv.status === statusFilter)

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !inviteeName.trim() || !inviteRole) return

    try {
      setIsSending(true)
      invitationCollection.insert({
        id: crypto.randomUUID(),
        email: email.trim().toLowerCase(),
        name: inviteeName.trim(),
        role: inviteRole,
        status: "pending",
        invitedBy: session?.user?.id ?? "",
        inviterName: session?.user?.name ?? "",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        acceptedAt: null,
      })
      toast.success(`Invitation sent to ${email}`)
      setEmail("")
      setInviteeName("")
      setInviteRole("")
    } catch (err: any) {
      toast.error(err.message ?? "Failed to send invitation")
    } finally {
      setIsSending(false)
    }
  }

  function handleRevoke(invitationId: string) {
    try {
      invitationCollection.delete(invitationId)
      toast.success("Invitation revoked")
    } catch {
      toast.error("Failed to revoke invitation")
    }
  }

  async function handleResend(invitationId: string) {
    const result = await resendInviteAction({ invitationId })
    if ("error" in result) {
      toast.error(result.error)
    } else {
      toast.success("Invitation resent")
    }
  }

  const STATUS_BADGES: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "default",
    accepted: "secondary",
    expired: "destructive",
    revoked: "outline",
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Invitations</h2>

      <form onSubmit={handleSendInvite} className="flex flex-col sm:flex-row gap-3 items-end">
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="invite-name">Name</Label>
          <Input
            id="invite-name"
            value={inviteeName}
            onChange={(e) => setInviteeName(e.target.value)}
            placeholder="John Doe"
            disabled={isSending}
          />
        </div>
        <div className="space-y-1.5 flex-1">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="john@example.com"
            disabled={isSending}
          />
        </div>
        <div className="space-y-1.5 w-40">
          <Label>Role</Label>
          <Select
            value={inviteRole}
            onValueChange={(val: string | null) => val && setInviteRole(val as UserRole)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((role) => (
                <SelectItem key={role} value={role}>
                  {role === "loanOfficer"
                    ? "Loan Officer"
                    : role === "superAdmin"
                      ? "Super Admin"
                      : role.charAt(0).toUpperCase() + role.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={isSending || !email.trim() || !inviteeName.trim() || !inviteRole}>
          Send Invite
        </Button>
      </form>

      <div className="flex gap-2">
        {["all", "pending", "accepted", "expired", "revoked"].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {filteredInvitations.length === 0 ? (
        <p className="text-muted-foreground text-sm">No invitations found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent By</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvitations.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="font-medium">{inv.name}</TableCell>
                <TableCell>{inv.email}</TableCell>
                <TableCell>
                  {inv.role === "loanOfficer"
                    ? "Loan Officer"
                    : inv.role === "superAdmin"
                      ? "Super Admin"
                      : inv.role.charAt(0).toUpperCase() + inv.role.slice(1)}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGES[inv.status] ?? "outline"}>
                    {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell>{inv.inviterName ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                  {formatDate(inv.createdAt)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground font-mono tabular-nums">
                  {formatDate(inv.expiresAt)}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    {inv.status === "pending" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResend(inv.id)}
                        >
                          Resend
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRevoke(inv.id)}
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                    {inv.status === "expired" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResend(inv.id)}
                      >
                        Resend
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Start dev server and verify the admin page renders**

Run: `pnpm dev`

Navigate to `/admin` as an admin user. Verify:
- Invitations section appears below delegations
- Form has Name, Email, Role fields and Send Invite button
- Status filter buttons render (All, Pending, Accepted, Expired, Revoked)
- Table shows "No invitations found." initially

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/admin/page.tsx
git commit -m "feat: add invitations management section to admin page"
```

---

### Task 9: Cypress DB Tasks + Test API Endpoint

**Files:**
- Modify: `cypress.config.ts`

- [ ] **Step 1: Add invitation-related Cypress tasks**

Add these tasks inside the `on("task", { ... })` block in `cypress.config.ts`:

```typescript
        async "db:getInvitations"() {
          return withSql(async (sql) => {
            const rows = await sql`
              SELECT id, email, name, role, status, token, expires_at, created_at
              FROM invitation ORDER BY created_at DESC
            `
            return rows
          })
        },

        async "db:getInviteUrl"({ email }: { email: string }) {
          const res = await fetch(`http://localhost:3000/api/test/invite-url?email=${encodeURIComponent(email)}`)
          if (!res.ok) return null
          const data = await res.json()
          return data.url ?? null
        },

        async "db:cleanInvitations"() {
          return withSql(async (sql) => {
            await sql`DELETE FROM invitation`
            return null
          })
        },
```

- [ ] **Step 2: Add the invitation table to the db:reset task**

In the `db:reset` task, add `DELETE FROM invitation;` before `DELETE FROM "user";`:

```sql
              DELETE FROM invitation;
              DELETE FROM "user";
```

- [ ] **Step 3: Create test API endpoint for invite URLs**

Create `src/app/api/test/invite-url/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "test" && process.env.CYPRESS !== "true") {
    return NextResponse.json({ error: "Not available" }, { status: 404 })
  }

  const email = request.nextUrl.searchParams.get("email")
  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 })
  }

  // Dynamic import to avoid loading test code in production
  const { pendingInviteUrls } = await import("@/services/invitation.service")
  const url = pendingInviteUrls.get(email)

  if (!url) {
    return NextResponse.json({ error: "No pending invite URL" }, { status: 404 })
  }

  return NextResponse.json({ url })
}
```

- [ ] **Step 4: Commit**

```bash
git add cypress.config.ts src/app/api/test/invite-url/route.ts
git commit -m "feat: add Cypress DB tasks and test API for invitations"
```

---

### Task 10: Cypress E2E Tests

**Files:**
- Create: `cypress/e2e/invitations.cy.ts`

- [ ] **Step 1: Write comprehensive E2E tests**

```typescript
// cypress/e2e/invitations.cy.ts

describe("Invitation System", () => {
  const adminEmail = `admin-${Date.now()}@fidexa.org`
  const adminName = "Test Admin"
  const adminPassword = "TestPass123!"

  beforeEach(() => {
    cy.task("db:reset")
  })

  function registerAndPromote(email: string, name: string, password: string, role: string) {
    cy.visit("/register")
    cy.get("#name").type(name)
    cy.get("#email").type(email)
    cy.get("#password").type(password)
    cy.get("#confirmPassword").type(password)
    cy.get("button[type='submit']").click()

    // First user auto-promoted to superAdmin, otherwise promote manually
    cy.task("db:promoteUser", { email, role })
    cy.clearCookies()
  }

  function loginAs(email: string, password: string) {
    cy.visit("/login")
    cy.get("#email").type(email)
    cy.get("#password").type(password)
    cy.get("button[type='submit']").click()
    cy.url().should("not.include", "/login", { timeout: 10000 })
  }

  describe("Sending Invitations", () => {
    beforeEach(() => {
      registerAndPromote(adminEmail, adminName, adminPassword, "superAdmin")
      loginAs(adminEmail, adminPassword)
    })

    it("sends an invitation and shows it in the table", () => {
      cy.visit("/admin")
      cy.contains("Invitations").should("be.visible")

      cy.get("#invite-name").type("John Doe")
      cy.get("#invite-email").type("john@example.com")
      // Select role
      cy.get("section").contains("Invitations").parent().within(() => {
        cy.contains("Select role").click()
      })
      cy.contains("Loan Officer").click()

      cy.contains("button", "Send Invite").click()
      cy.contains("Invitation sent").should("be.visible")

      // Verify invitation appears in table
      cy.contains("john@example.com").should("be.visible")
      cy.contains("John Doe").should("be.visible")
      cy.contains("Pending").should("be.visible")
    })

    it("rejects duplicate email for registered user", () => {
      cy.visit("/admin")
      cy.get("#invite-name").type("Duplicate Admin")
      cy.get("#invite-email").type(adminEmail)
      cy.get("section").contains("Invitations").parent().within(() => {
        cy.contains("Select role").click()
      })
      cy.contains("Loan Officer").click()

      cy.contains("button", "Send Invite").click()
      cy.contains("already has an account").should("be.visible")
    })

    it("revokes a pending invitation", () => {
      cy.visit("/admin")
      cy.get("#invite-name").type("To Revoke")
      cy.get("#invite-email").type("revoke@example.com")
      cy.get("section").contains("Invitations").parent().within(() => {
        cy.contains("Select role").click()
      })
      cy.contains("Loan Officer").click()
      cy.contains("button", "Send Invite").click()
      cy.contains("Invitation sent").should("be.visible")

      cy.contains("button", "Revoke").click()
      cy.contains("Invitation revoked").should("be.visible")
    })

    it("filters invitations by status", () => {
      // Send an invitation first
      cy.visit("/admin")
      cy.get("#invite-name").type("Filter Test")
      cy.get("#invite-email").type("filter@example.com")
      cy.get("section").contains("Invitations").parent().within(() => {
        cy.contains("Select role").click()
      })
      cy.contains("Loan Officer").click()
      cy.contains("button", "Send Invite").click()
      cy.contains("Invitation sent").should("be.visible")

      // Filter to accepted (should be empty)
      cy.contains("button", "Accepted").click()
      cy.contains("No invitations found").should("be.visible")

      // Filter back to pending
      cy.contains("button", "Pending").click()
      cy.contains("filter@example.com").should("be.visible")
    })
  })

  describe("Accepting Invitations", () => {
    beforeEach(() => {
      registerAndPromote(adminEmail, adminName, adminPassword, "superAdmin")
    })

    it("accepts an invitation and creates an account with the assigned role", () => {
      // Login as admin and send invite
      loginAs(adminEmail, adminPassword)
      cy.visit("/admin")
      cy.get("#invite-name").type("New Officer")
      cy.get("#invite-email").type("officer@example.com")
      cy.get("section").contains("Invitations").parent().within(() => {
        cy.contains("Select role").click()
      })
      cy.contains("Loan Officer").click()
      cy.contains("button", "Send Invite").click()
      cy.contains("Invitation sent").should("be.visible")

      // Logout
      cy.clearCookies()

      // Get invite URL from test endpoint
      cy.task("db:getInviteUrl", { email: "officer@example.com" }).then((url) => {
        expect(url).to.not.be.null
        // Extract path + query from full URL
        const parsed = new URL(url as string)
        cy.visit(parsed.pathname + parsed.search)
      })

      // Should see welcome page
      cy.contains("Welcome, New Officer").should("be.visible")
      cy.contains("Loan Officer").should("be.visible")

      // Set password
      cy.get("#password").type("OfficerPass123!")
      cy.get("#confirmPassword").type("OfficerPass123!")
      cy.get("button[type='submit']").click()

      // Should be redirected to the app
      cy.url().should("not.include", "/accept-invite", { timeout: 10000 })

      // Verify role was assigned
      cy.task("db:getUserRole", { email: "officer@example.com" }).then((result: any) => {
        expect(result.role).to.equal("loanOfficer")
      })
    })

    it("shows error for invalid token", () => {
      cy.visit("/accept-invite?token=invalid-token-123")
      cy.contains("Invitation Invalid").should("be.visible")
      cy.contains("Invalid invitation link").should("be.visible")
    })

    it("shows error when no token is provided", () => {
      cy.visit("/accept-invite")
      cy.contains("Invitation Invalid").should("be.visible")
    })
  })

  describe("Permission Enforcement", () => {
    it("hides invitations section from loan officers", () => {
      const officerEmail = `officer-${Date.now()}@fidexa.org`
      const officerPassword = "OfficerPass123!"
      registerAndPromote(adminEmail, adminName, adminPassword, "superAdmin")
      registerAndPromote(officerEmail, "LO User", officerPassword, "loanOfficer")

      loginAs(officerEmail, officerPassword)
      cy.visit("/admin")
      // Loan officers can't even see the admin page
      cy.contains("Access denied").should("be.visible")
    })
  })
})
```

- [ ] **Step 2: Run Cypress tests**

Run: `npx cypress run --spec cypress/e2e/invitations.cy.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add cypress/e2e/invitations.cy.ts
git commit -m "test: add E2E tests for invitation system"
```

---

### Task 11: Final Integration Check

- [ ] **Step 1: Run full TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run full Cypress test suite**

Run: `npx cypress run`
Expected: All tests pass including existing tests (no regressions).

- [ ] **Step 3: Verify complete flow manually in dev**

Run: `pnpm dev`

1. Login as admin → go to `/admin`
2. Send an invitation with name, email, role
3. Check test endpoint for invite URL (or check Resend dashboard in production)
4. Open invite URL in incognito
5. Set password → verify auto-login and role assignment
6. Return to admin → verify invitation shows as "Accepted"

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: integration fixes for invite system"
```
