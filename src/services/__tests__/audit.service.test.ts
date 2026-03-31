import { describe, it, expect, vi, beforeEach } from "vitest"

function createMockTx() {
  const mockInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  })
  return { insert: mockInsert }
}

describe("Audit Service", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("inserts an audit log entry with stringified values", async () => {
    const { writeAuditLog } = await import("@/services/audit.service")
    const mockTx = createMockTx()

    await writeAuditLog(mockTx, {
      actorId: "user-1",
      action: "test.action",
      entityType: "widget",
      entityId: "widget-42",
      beforeValue: { color: "red" },
      afterValue: { color: "blue" },
    })

    expect(mockTx.insert).toHaveBeenCalledTimes(1)
    const valuesCall = mockTx.insert.mock.results[0].value.values
    expect(valuesCall).toHaveBeenCalledWith({
      actorId: "user-1",
      action: "test.action",
      entityType: "widget",
      entityId: "widget-42",
      beforeValue: JSON.stringify({ color: "red" }),
      afterValue: JSON.stringify({ color: "blue" }),
    })
  })

  it("sets beforeValue to null when null is passed", async () => {
    const { writeAuditLog } = await import("@/services/audit.service")
    const mockTx = createMockTx()

    await writeAuditLog(mockTx, {
      actorId: "user-1",
      action: "entity.create",
      entityType: "thing",
      entityId: "thing-1",
      beforeValue: null,
      afterValue: { name: "New Thing" },
    })

    const valuesCall = mockTx.insert.mock.results[0].value.values
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeValue: null,
        afterValue: JSON.stringify({ name: "New Thing" }),
      })
    )
  })

  it("sets afterValue to null when null is passed", async () => {
    const { writeAuditLog } = await import("@/services/audit.service")
    const mockTx = createMockTx()

    await writeAuditLog(mockTx, {
      actorId: "user-2",
      action: "entity.delete",
      entityType: "thing",
      entityId: "thing-2",
      beforeValue: { name: "Old Thing" },
      afterValue: null,
    })

    const valuesCall = mockTx.insert.mock.results[0].value.values
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeValue: JSON.stringify({ name: "Old Thing" }),
        afterValue: null,
      })
    )
  })

  it("propagates database errors from tx.insert", async () => {
    const { writeAuditLog } = await import("@/services/audit.service")

    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("DB connection lost")),
    })
    const mockTx = { insert: mockInsert }

    await expect(
      writeAuditLog(mockTx, {
        actorId: "user-1",
        action: "test.fail",
        entityType: "widget",
        entityId: "widget-1",
        beforeValue: null,
        afterValue: null,
      })
    ).rejects.toThrow("DB connection lost")
  })
})
