/**
 * Shared session fixtures and typed helpers for action tests.
 *
 * IMPORTANT: You must still declare vi.mock() and vi.mocked() at the module level
 * in each test file because Vitest hoists vi.mock() calls and path aliases only
 * resolve through Vitest's transform (not Node require). This module consolidates
 * the duplicated session fixture definitions that were copy-pasted across all
 * test files.
 *
 * Two auth patterns exist in the codebase:
 *   1. Direct: vi.mocked(auth.api.getSession)     — chat, creditor, expense, income
 *   2. Wrapped: vi.mocked(getSession) from action-utils — the rest
 *
 * Each test file keeps its own vi.mocked() wrappers for auth (since the import
 * differs), but pulls session fixtures from here.
 *
 * Usage:
 *   import { fakeSession, lowRoleSession, effectReturn } from "./test-utils"
 */

import { Effect } from "effect"
import type { Session, SessionUser } from "@/lib/action-utils"
import type { UserRole } from "@/types"

/**
 * Build a fully-typed Session for tests. We only care about a handful of fields
 * (user.id, user.role, etc.) — the rest of Better Auth's runtime shape is
 * filled in with minimal valid values via `unknown` cast.
 */
export function makeSession(
  role: UserRole,
  overrides: Partial<SessionUser> = {},
): Session {
  const now = new Date()
  const user = {
    id: overrides.id ?? "u-default",
    name: overrides.name ?? "Test",
    email: overrides.email ?? "t@t.com",
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
    role,
    ...overrides,
  }
  const session = {
    id: "s-default",
    token: "tok",
    userId: user.id,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
    ipAddress: null,
    userAgent: null,
  }
  // Better Auth's runtime Session type carries many fields we never touch in
  // tests. Casting through `unknown` keeps us inside the type system without
  // resorting to `any`.
  return { user, session } as unknown as Session
}

export const fakeSession: Session = makeSession("admin", {
  id: "u1",
  name: "Test",
  email: "t@t.com",
})

export const lowRoleSession: Session = makeSession("unassigned", {
  id: "u2",
  name: "Low",
  email: "l@l.com",
})

export const loanOfficerSession: Session = makeSession("loanOfficer", {
  id: "u3",
  name: "Officer",
  email: "officer@t.com",
})

export const supervisorSession: Session = makeSession("supervisor", {
  id: "u4",
  name: "Supervisor",
  email: "super@t.com",
})

export const superAdminSession: Session = makeSession("superAdmin", {
  id: "u5",
  name: "SuperAdmin",
  email: "sa@t.com",
})

// ---------------------------------------------------------------------------
// Effect mock helpers
// ---------------------------------------------------------------------------
//
// Service functions in this app return `Effect.Effect<TData, TError>`. In
// tests we construct simplified payloads (e.g. `{ id: "c1" }`) that don't
// match the full domain types. `effectReturn` casts an Effect through
// `unknown` to the real return type of a service function, so `vi.mocked(svc)
// .mockReturnValue(effectReturn<typeof svc>(Effect.succeed(stub)))` stays
// type-checked at the call site without `as any`.

type EffectReturnOf<F> = F extends (...args: never[]) => infer R ? R : never

export function effectReturn<F extends (...args: never[]) => unknown>(
  value: Effect.Effect<unknown, unknown>,
): EffectReturnOf<F> {
  return value as unknown as EffectReturnOf<F>
}
