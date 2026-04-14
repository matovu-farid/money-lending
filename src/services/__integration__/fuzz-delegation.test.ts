/**
 * Integration Fuzz Tests — Real Database Delegation Invariants
 *
 * These tests run against the real PostgreSQL database, generating random
 * supervisor selections and verifying delegation lifecycle invariants:
 *
 *   1. Create-then-get idempotency
 *   2. No double delegation
 *   3. Revoke-then-get nullity
 *   4. Create-revoke-create cycle
 *   5. Non-supervisor rejection
 *   6. List monotonicity
 *   7. Revoking non-existent delegation
 *
 * Uses fast-check for structured random generation with shrinking.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb } from "./setup"
import fc from "fast-check"
import * as schema from "@/lib/db/schema"
import {
  createDelegation,
  revokeDelegation,
  getActiveDelegation,
  listDelegations,
} from "@/services/delegation.service"

// ─── Constants ────────────────────────────────────────────────────

const TEST_TIMEOUT = 120_000
const FUZZ_ITERATIONS = 10

// ─── Test Suite ───────────────────────────────────────────────────

describe(
  "Integration Fuzz: Delegation Invariants",
  { timeout: TEST_TIMEOUT, sequential: true },
  () => {
    beforeEach(async () => {
      await resetDb()

      const supervisors = Array.from({ length: 5 }, (_, i) => ({
        id: `sup-${i}`,
        name: `Supervisor ${i}`,
        email: `sup-${i}@test.local`,
        emailVerified: true,
        role: "supervisor" as const,
      }))

      await testDb
        .insert(schema.user)
        .values([
          ...supervisors,
          {
            id: "admin-fuzz",
            name: "Admin Fuzz",
            email: "admin-fuzz@test.local",
            emailVerified: true,
            role: "admin" as const,
          },
        ])
        .onConflictDoNothing()
    }, TEST_TIMEOUT)

    it("create-then-get idempotency: created delegation is retrievable", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 4 }),
          async (supIdx) => {
            // Clean delegations between iterations
            await testDb.delete(schema.delegations)

            const userId = `sup-${supIdx}`
            const created = await createDelegation(userId, "admin-fuzz")
            const active = await getActiveDelegation(userId)

            expect(active).not.toBeNull()
            expect(active!.id).toBe(created.id)
            expect(active!.userId).toBe(userId)
            expect(active!.delegatedBy).toBe("admin-fuzz")
          },
        ),
        { numRuns: FUZZ_ITERATIONS },
      )
    })

    it("no double delegation: second creation for same supervisor throws", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 4 }),
          async (supIdx) => {
            await testDb.delete(schema.delegations)

            const userId = `sup-${supIdx}`
            await createDelegation(userId, "admin-fuzz")

            await expect(
              createDelegation(userId, "admin-fuzz"),
            ).rejects.toThrow("User already has an active delegation")
          },
        ),
        { numRuns: FUZZ_ITERATIONS },
      )
    })

    it("revoke-then-get nullity: after revocation getActiveDelegation returns null", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 4 }),
          async (supIdx) => {
            await testDb.delete(schema.delegations)

            const userId = `sup-${supIdx}`
            const created = await createDelegation(userId, "admin-fuzz")
            await revokeDelegation(created.id, "admin-fuzz")

            const active = await getActiveDelegation(userId)
            expect(active).toBeNull()
          },
        ),
        { numRuns: FUZZ_ITERATIONS },
      )
    })

    it("create-revoke-create cycle: supervisor can receive new delegation after revocation", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 4 }),
          async (supIdx) => {
            await testDb.delete(schema.delegations)

            const userId = `sup-${supIdx}`

            // First cycle
            const first = await createDelegation(userId, "admin-fuzz")
            await revokeDelegation(first.id, "admin-fuzz")

            // Second cycle — should not throw
            const second = await createDelegation(userId, "admin-fuzz")
            expect(second.id).not.toBe(first.id)

            const active = await getActiveDelegation(userId)
            expect(active).not.toBeNull()
            expect(active!.id).toBe(second.id)
          },
        ),
        { numRuns: FUZZ_ITERATIONS },
      )
    })

    it("non-supervisor rejection: creating delegation for admin always throws", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 4 }),
          async (_supIdx) => {
            // The supIdx is unused but keeps the generator consistent
            await testDb.delete(schema.delegations)

            await expect(
              createDelegation("admin-fuzz", "admin-fuzz"),
            ).rejects.toThrow("Only supervisors can receive delegations")
          },
        ),
        { numRuns: FUZZ_ITERATIONS },
      )
    })

    it("list monotonicity: after N creates, listDelegations returns at least N rows", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (n) => {
            await testDb.delete(schema.delegations)

            const count = Math.min(n, 5) // cap at number of supervisors
            for (let i = 0; i < count; i++) {
              await createDelegation(`sup-${i}`, "admin-fuzz")
            }

            const all = await listDelegations()
            expect(all.length).toBeGreaterThanOrEqual(count)
          },
        ),
        { numRuns: FUZZ_ITERATIONS },
      )
    })

    it("revoking non-existent delegation: random UUID always throws", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (randomId) => {
            await expect(
              revokeDelegation(randomId, "admin-fuzz"),
            ).rejects.toThrow("Active delegation not found")
          },
        ),
        { numRuns: FUZZ_ITERATIONS },
      )
    })
  },
)
