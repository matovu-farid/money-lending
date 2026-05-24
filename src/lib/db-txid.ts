import { sql } from "drizzle-orm"
import type { db } from "@/lib/db"

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Shape of one row produced by the SELECT below. */
type TxidRow = {
  txid: string
} & Record<string, unknown>

/**
 * Returns the current Postgres transaction id as a number.
 *
 * Used inside transactions to capture the txid that TanStack DB / Electric
 * collections need as the optimistic-update sync token. Centralised here so
 * the postgres-js RowList → array coercion lives in one place rather than
 * being repeated (and potentially mistyped) at every call site.
 *
 * `tx.execute<TxidRow>(...)` returns a postgres-js `RowList<TxidRow[]>` whose
 * declared shape isn't a plain array; we narrow it via the iterator below.
 */
export async function getCurrentTxid(tx: DrizzleTx): Promise<number> {
  const rows = await tx.execute<TxidRow>(
    sql`SELECT pg_current_xact_id()::text as txid`,
  )
  // RowList iterates the same way as Array.prototype[Symbol.iterator]; the
  // first element is the only one we care about. This is the sole boundary
  // cast for the postgres-js → plain-row narrowing.
  const [first] = rows as unknown as Iterable<TxidRow>
  if (!first) {
    throw new Error(
      "getCurrentTxid: SELECT pg_current_xact_id() returned no rows",
    )
  }
  return Number(first.txid)
}
