/**
 * Pure, client-safe helpers for working with server-action results.
 *
 * Lives here (not in `with-action.ts`) because `with-action.ts` pulls in
 * server-only modules (`next/headers`, the DB, the IP allowlist). Importing
 * anything from `with-action.ts` into a `"use client"` file drags the whole
 * server graph into the browser bundle and breaks at `postgres`'s `fs` import.
 */

/**
 * Type guard for the `{ error: string }` shape returned by classic actions.
 *
 * Use at callsites to narrow a server-action result before reading success
 * fields. Reliable across all `withAction` overloads — `withAction`'s
 * `TResult | { error: string }` union can produce a 3-branch shape after
 * composition that property-key narrowing (`"error" in result`) handles
 * unreliably. This explicit guard sidesteps that.
 */
export function isErrorResult(x: unknown): x is { error: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    "error" in x &&
    typeof (x as { error: unknown }).error === "string"
  )
}
