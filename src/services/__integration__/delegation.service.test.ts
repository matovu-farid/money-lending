import { describe, it, expect, beforeAll } from "vitest"
import { resetDb, testDb } from "./setup"
import * as schema from "@/lib/db/schema"
import { eq, and, isNull } from "drizzle-orm"
import {
  createDelegation,
  revokeDelegation,
  getActiveDelegation,
  listDelegations,
} from "@/services/delegation.service"

const SUPERVISOR_ID = "supervisor-del-test"
const ADMIN_ID = "admin-del-test"
const AGENT_ID = "agent-del-test"

describe("Delegation Service — Integration", () => {
  beforeAll(async () => {
    await resetDb()

    // Seed users with specific roles
    await testDb.insert(schema.user).values([
      {
        id: SUPERVISOR_ID,
        name: "Supervisor User",
        email: "supervisor-del@test.local",
        emailVerified: true,
        role: "supervisor",
      },
      {
        id: ADMIN_ID,
        name: "Admin User",
        email: "admin-del@test.local",
        emailVerified: true,
        role: "admin",
      },
      {
        id: AGENT_ID,
        name: "Agent User",
        email: "agent-del@test.local",
        emailVerified: true,
        role: "agent",
      },
    ]).onConflictDoNothing()

    // Clean any leftover delegations
    await testDb.delete(schema.delegations)
  })

  // ─── Create → Get → List → Revoke flow ────────────────────────────

  it("creates a delegation for a supervisor", async () => {
    const result = await createDelegation(SUPERVISOR_ID, ADMIN_ID)

    expect(result.id).toBeDefined()
    expect(result.userId).toBe(SUPERVISOR_ID)
    expect(result.delegatedBy).toBe(ADMIN_ID)
    expect(result.revokedAt).toBeNull()
    expect(result.revokedBy).toBeNull()
    expect(result.createdAt).toBeInstanceOf(Date)
  })

  it("getActiveDelegation returns the created delegation", async () => {
    const result = await getActiveDelegation(SUPERVISOR_ID)

    expect(result).not.toBeNull()
    expect(result!.userId).toBe(SUPERVISOR_ID)
    expect(result!.revokedAt).toBeNull()
  })

  it("listDelegations includes the delegation with user name", async () => {
    const rows = await listDelegations()

    expect(rows.length).toBeGreaterThanOrEqual(1)
    const found = rows.find((r) => r.userId === SUPERVISOR_ID)
    expect(found).toBeDefined()
    expect(found!.userName).toBe("Supervisor User")
  })

  it("revokes the active delegation", async () => {
    const active = await getActiveDelegation(SUPERVISOR_ID)
    expect(active).not.toBeNull()

    const result = await revokeDelegation(active!.id, ADMIN_ID)

    expect(result.revokedAt).toBeInstanceOf(Date)
    expect(result.revokedBy).toBe(ADMIN_ID)
  })

  it("getActiveDelegation returns null after revocation", async () => {
    const result = await getActiveDelegation(SUPERVISOR_ID)
    expect(result).toBeNull()
  })

  // ─── Duplicate delegation prevention ───────────────────────────────

  it("prevents creating a second active delegation for the same user", async () => {
    // Create first delegation
    await createDelegation(SUPERVISOR_ID, ADMIN_ID)

    // Attempt a second one
    await expect(createDelegation(SUPERVISOR_ID, ADMIN_ID)).rejects.toThrow(
      "User already has an active delegation"
    )

    // Clean up: revoke the delegation for subsequent tests
    const active = await getActiveDelegation(SUPERVISOR_ID)
    if (active) {
      await revokeDelegation(active.id, ADMIN_ID)
    }
  })

  // ─── Non-supervisor rejection ──────────────────────────────────────

  it("rejects delegation for a non-supervisor (admin)", async () => {
    await expect(createDelegation(ADMIN_ID, ADMIN_ID)).rejects.toThrow(
      "Only supervisors can receive delegations"
    )
  })

  it("rejects delegation for a non-supervisor (agent)", async () => {
    await expect(createDelegation(AGENT_ID, ADMIN_ID)).rejects.toThrow(
      "Only supervisors can receive delegations"
    )
  })

  // ─── Revoke non-existent ──────────────────────────────────────────

  it("throws when revoking a non-existent delegation", async () => {
    await expect(
      revokeDelegation("00000000-0000-0000-0000-000000000000", ADMIN_ID)
    ).rejects.toThrow("Active delegation not found")
  })
})
