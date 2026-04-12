/**
 * Shared session fixtures for action tests.
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
 *   import { fakeSession, lowRoleSession } from "./test-utils"
 */

export const fakeSession = {
  user: { id: "u1", name: "Test", email: "t@t.com", role: "admin" },
} as any

export const lowRoleSession = {
  user: { id: "u2", name: "Low", email: "l@l.com", role: "unassigned" },
} as any

export const loanOfficerSession = {
  user: { id: "u3", name: "Officer", email: "officer@t.com", role: "loanOfficer" },
} as any

export const supervisorSession = {
  user: { id: "u4", name: "Supervisor", email: "super@t.com", role: "supervisor" },
} as any

export const superAdminSession = {
  user: { id: "u5", name: "SuperAdmin", email: "sa@t.com", role: "superAdmin" },
} as any
