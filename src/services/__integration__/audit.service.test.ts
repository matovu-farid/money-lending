import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, testDb } from "./setup"
import { writeAuditLog } from "@/services/audit.service"
import { auditLog } from "@/lib/db/schema/audit"
import { eq } from "drizzle-orm"

const TEST_TIMEOUT = 30_000

describe("Audit Service (integration)", () => {
  beforeEach(async () => {
    await resetDb()
  }, TEST_TIMEOUT)

  // ── 1. Basic insert ────────────────────────────────────────────────
  it("inserts an audit log entry with all fields", async () => {
    await testDb.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorId: "admin-1",
        action: "test.create",
        entityType: "widget",
        entityId: "widget-42",
        beforeValue: null,
        afterValue: { name: "Widget A" },
      })
    })

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, "widget-42"))

    expect(logs).toHaveLength(1)
    expect(logs[0].actorId).toBe("admin-1")
    expect(logs[0].action).toBe("test.create")
    expect(logs[0].entityType).toBe("widget")
    expect(logs[0].entityId).toBe("widget-42")
    expect(logs[0].beforeValue).toBeNull()
    expect(JSON.parse(logs[0].afterValue!)).toEqual({ name: "Widget A" })
    expect(logs[0].occurredAt).toBeInstanceOf(Date)
  }, TEST_TIMEOUT)

  // ── 2. Before and after values ─────────────────────────────────────
  it("stores both before and after values as JSON strings", async () => {
    await testDb.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorId: "admin-2",
        action: "test.update",
        entityType: "widget",
        entityId: "widget-99",
        beforeValue: { color: "red", size: 10 },
        afterValue: { color: "blue", size: 20 },
      })
    })

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, "widget-99"))

    expect(logs).toHaveLength(1)
    expect(JSON.parse(logs[0].beforeValue!)).toEqual({ color: "red", size: 10 })
    expect(JSON.parse(logs[0].afterValue!)).toEqual({ color: "blue", size: 20 })
  }, TEST_TIMEOUT)

  // ── 3. Null values ─────────────────────────────────────────────────
  it("stores null when beforeValue and afterValue are null", async () => {
    await testDb.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorId: "admin-3",
        action: "test.noop",
        entityType: "widget",
        entityId: "widget-0",
        beforeValue: null,
        afterValue: null,
      })
    })

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, "widget-0"))

    expect(logs).toHaveLength(1)
    expect(logs[0].beforeValue).toBeNull()
    expect(logs[0].afterValue).toBeNull()
  }, TEST_TIMEOUT)

  // ── 4. Multiple entries ────────────────────────────────────────────
  it("inserts multiple audit entries in sequence", async () => {
    await testDb.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorId: "admin-1",
        action: "entity.create",
        entityType: "item",
        entityId: "item-1",
        beforeValue: null,
        afterValue: { name: "Item 1" },
      })
      await writeAuditLog(tx, {
        actorId: "admin-1",
        action: "entity.update",
        entityType: "item",
        entityId: "item-1",
        beforeValue: { name: "Item 1" },
        afterValue: { name: "Item 1 Updated" },
      })
    })

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, "item-1"))

    expect(logs).toHaveLength(2)
    const actions = logs.map((l) => l.action).sort()
    expect(actions).toEqual(["entity.create", "entity.update"])
  }, TEST_TIMEOUT)

  // ── 5. Auto-generated fields ───────────────────────────────────────
  it("auto-generates id and occurredAt timestamp", async () => {
    await testDb.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorId: "admin-5",
        action: "test.auto",
        entityType: "thing",
        entityId: "thing-5",
        beforeValue: null,
        afterValue: null,
      })
    })

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, "thing-5"))

    expect(logs).toHaveLength(1)
    expect(logs[0].id).toBeDefined()
    expect(typeof logs[0].id).toBe("string")
    expect(logs[0].id.length).toBeGreaterThan(0)
    expect(logs[0].occurredAt).toBeInstanceOf(Date)
  }, TEST_TIMEOUT)
})
