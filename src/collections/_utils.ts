/**
 * Small helpers shared by the collection handler bodies in this directory.
 *
 * `throwIfActionError` collapses the repeated
 *   `if ("error" in result) throw new Error(result.error)`
 * unwrap pattern used by every `onInsert` / `onUpdate` / `onDelete` /
 * `queryFn` that calls a server action wrapped with `withAction`. Both
 * action result shapes are supported:
 *
 *   - Classic mode:  `TResult | { error: string }`
 *   - Effect mode:   `{ data: TData } | { error: string }`
 *
 * In both cases the helper returns the success branch unchanged so callers
 * can access whatever fields the action returns (`txid`, `data`, etc.). The
 * `Exclude` in the return type strips the error branch so `result.data` is
 * no longer typed as possibly undefined after the call.
 */
export function throwIfActionError<T>(
  result: T,
): Exclude<T, { error: string }> {
  if (result && typeof result === "object" && "error" in result) {
    throw new Error((result as { error: string }).error)
  }
  return result as Exclude<T, { error: string }>
}

/**
 * Coerce specified keys on each row to `Date`.
 *
 * Server Action responses serialize Drizzle `timestamp` columns to ISO strings
 * across the RSC payload boundary in Next.js 16. TanStack DB collection
 * schemas (`schema:`) only validate mutations, not `queryFn` output, so the
 * timestamps stay as strings and break consumer code that calls `.getTime()`,
 * `.toISOString()`, etc. (See `collection-query-fn-needs-explicit-date-coercion`
 * in agent memory for the post-Electric history.)
 *
 * Idempotent: `Date` values pass through unchanged. `null` / `undefined` pass
 * through unchanged so optional timestamp columns stay nullable.
 */
export function coerceDates<T extends object>(
  rows: T[],
  keys: ReadonlyArray<keyof T>,
): T[] {
  return rows.map((row) => {
    const out = { ...row }
    for (const key of keys) {
      const val = out[key]
      if (val == null || val instanceof Date) continue
      ;(out as Record<string, unknown>)[key as string] = new Date(
        val as string | number,
      )
    }
    return out
  })
}
