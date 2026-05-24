/**
 * Shared type helpers for service unit tests.
 *
 * These types let mock builders match the real drizzle / db function signatures
 * without resorting to `any`. They are intentionally narrow: each helper aliases
 * a small slice of the production return type so that `as unknown as <Helper>`
 * casts on chained mocks remain readable while still being type-checked.
 */
import type { db as realDb } from "@/lib/db"
import type { vi } from "vitest"

/** The shape of the real drizzle `db` handle. */
export type RealDb = typeof realDb

/** The transaction object passed to `db.transaction(async (tx) => ...)`. */
export type DrizzleTx = Parameters<Parameters<RealDb["transaction"]>[0]>[0]

/** Return type of `db.select()` / `tx.select()`. */
export type SelectReturn = ReturnType<RealDb["select"]>
/** Return type of `db.insert(table)` / `tx.insert(table)`. */
export type InsertReturn = ReturnType<RealDb["insert"]>
/** Return type of `db.update(table)` / `tx.update(table)`. */
export type UpdateReturn = ReturnType<RealDb["update"]>
/** Return type of `db.delete(table)` / `tx.delete(table)`. */
export type DeleteReturn = ReturnType<RealDb["delete"]>

/** Generic vitest mock type without parameter binding. */
export type Mocked = ReturnType<typeof vi.fn>

/**
 * Callback shape used by `db.transaction(cb)`. The real drizzle callback receives
 * a `DrizzleTx`; tests substitute a structural mock that only implements the
 * methods the service-under-test actually invokes.
 */
export type TransactionCallback<T = unknown> = (tx: DrizzleTx) => Promise<T>
