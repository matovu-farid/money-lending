import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { transactionCategories } from "@/lib/db/schema/transaction-categories"

/** Install only this account; broad default seeding would activate unrelated accruals. */
export async function installInterestReceivableAsset(
  database: typeof db = db,
): Promise<{ id: string; created: boolean }> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('money-lending/interest-receivable-asset'))`)
    const existing = await tx.select().from(transactionCategories)
      .where(eq(transactionCategories.name, "Interest Receivable"))
    if (existing.some((row) => row.type !== "asset") || existing.length > 1) {
      throw new Error("Interest Receivable has a wrong-type or duplicate account")
    }
    if (existing.length === 1) return { id: existing[0].id, created: false }
    const [inserted] = await tx.insert(transactionCategories).values({
      name: "Interest Receivable", type: "asset", isDefault: true,
    }).returning({ id: transactionCategories.id })
    return { id: inserted.id, created: true }
  }, { isolationLevel: "serializable" })
}
