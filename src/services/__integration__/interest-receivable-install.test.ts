import { beforeEach, describe, expect, it } from "vitest"
import { resetDb, testDb } from "./setup"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"
import { installInterestReceivableAsset } from "../interest-receivable-install.service"

describe("one-account Interest Receivable installation", () => {
  beforeEach(async () => { await resetDb() })

  it("creates only the asset account and does nothing on replay", async () => {
    const first = await installInterestReceivableAsset(testDb)
    const second = await installInterestReceivableAsset(testDb)
    expect(first).toEqual({ id: second.id, created: true })
    expect(second.created).toBe(false)
    expect(await testDb.select().from(transactionCategories)).toEqual([
      expect.objectContaining({ name: "Interest Receivable", type: "asset" }),
    ])
  })

  it("refuses a same-name revenue account without creating another category", async () => {
    await testDb.insert(transactionCategories).values({
      name: "Interest Receivable", type: "revenue", isDefault: true,
    })
    await expect(installInterestReceivableAsset(testDb)).rejects.toThrow(/wrong-type/i)
    expect(await testDb.select().from(transactionCategories)).toHaveLength(1)
  })
})
