import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getTableConfig } from "drizzle-orm/pg-core"
import { customers } from "../customers"

describe("customers schema", () => {
  it("has a unique constraint on nin to prevent duplicate national IDs", () => {
    const config = getTableConfig(customers)
    const match = config.uniqueConstraints.find((c) => {
      const colNames = c.columns.map((col) => col.name)
      return colNames.includes("nin")
    })
    expect(match).toBeDefined()
    expect(match!.name).toBe("uq_customers_nin")
  })

  it("has a unique contact index to prevent duplicate phone numbers", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0026_powerful_retro_girl.sql"),
      "utf8",
    )
    expect(migration).toContain('CREATE UNIQUE INDEX "uq_customers_contact"')
    expect(migration).toContain(`WHERE "customers"."contact" <> ''`)
  })
})
