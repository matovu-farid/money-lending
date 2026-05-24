"use client"

import {
  ShapeStream,
  isChangeMessage,
  snakeCamelMapper,
} from "@electric-sql/client"
import type { QueryClient } from "@tanstack/react-query"

/**
 * Default `onError` handler for ShapeStreams. Without it, non-retryable errors
 * (proxy 401 from a session-lookup timeout, 502 from upstream Electric being
 * unreachable, network drops while offline) bubble out of the ShapeStream as
 * unhandled promise rejections, which Next.js logs as `unhandledRejection:
 * FetchError` and which can crash the page.
 *
 * Returning `{}` tells the client to retry with the same params; the underlying
 * client already does exponential backoff. This makes the shape stream
 * "self-healing" once the user is back online or the session is restored.
 */
export function shapeOnError(label: string) {
  return (err: unknown): Record<string, never> => {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? (err as { status: unknown }).status
        : undefined
    if (typeof status === "number") {
      console.warn(`[electric] shape "${label}" error ${status}; retrying`)
    } else {
      console.warn(`[electric] shape "${label}" error; retrying`, err)
    }
    return {}
  }
}

/**
 * Build the shape proxy URL for a given table.
 * In the browser this resolves to /api/electric/<table>.
 * The proxy route handles auth, secret injection, and table whitelisting.
 */
export function shapeUrl(table: string): string {
  if (typeof window !== "undefined") {
    return new URL(`/api/electric/${table}`, window.location.origin).href
  }
  // SSR fallback — shouldn't happen since Electric collections are client-only
  return `/api/electric/${table}`
}

/**
 * Parser plugged into every Electric `ShapeStream` so Drizzle `timestamp` /
 * `timestamptz` / `date` columns arrive as `Date` objects instead of raw ISO
 * strings.
 *
 * Why this is necessary even though collections declare a Zod `schema`:
 * `@tanstack/electric-db-collection` only runs the schema's validate/parse
 * pipeline on *client-side* mutations (insert / update). Rows pushed by the
 * Electric stream are written straight through, so `z.coerce.date()` on the
 * collection schema never fires for them. Coercion must therefore happen at
 * the wire layer — here.
 *
 * The Postgres type names below mirror the keys that `@electric-sql/client`'s
 * `MessageParser` looks up (taken from the `electric-schema` response header
 * emitted by the Electric server). The client's `defaultParser` covers ints,
 * bools, floats, and json; timestamp / date are unset and fall through to the
 * identity parser, which is exactly what broke `paymentDate.getTime()` on
 * /loans/:loanId.
 *
 * The signature matches `@electric-sql/client`'s internal `ParseFunction`:
 * `(value: string, additionalInfo?) => Date`. The second arg is unused here
 * (timestamp parsing doesn't need column metadata) but is part of the contract
 * we accept from upstream. Typing it ensures the function remains assignable
 * to `ShapeStreamOptions<Date>.parser` after a future Electric upgrade.
 */
type ElectricFieldParser = (value: string, additionalInfo?: unknown) => Date

const parseTimestamp: ElectricFieldParser = (value) => new Date(value)

/**
 * Extensions parameter for Electric stream rows synced with these parsers.
 * Tells the upstream `ShapeStreamOptions` typing that, in addition to the
 * default scalar types, our row Values may contain `Date` (returned by the
 * timestamp/date parsers below).
 */
export type ElectricRowExtensions = Date

export const electricDateParsers: Readonly<{
  timestamp: ElectricFieldParser
  timestamptz: ElectricFieldParser
  date: ElectricFieldParser
}> = {
  timestamp: parseTimestamp,
  timestamptz: parseTimestamp,
  date: parseTimestamp,
}

/**
 * Build the `shapeOptions` block that every Electric collection should use.
 * Centralizing this guarantees that the date parser is wired everywhere — if
 * any collection drifts back to inline `{ url, columnMapper, onError }`
 * options, the next dev who calls `.getTime()` on a Date column gets the same
 * production crash this helper exists to prevent.
 *
 * Collections that need extra knobs (Electric `params`, `replica`, etc.) can
 * spread the result and add their own fields.
 *
 * Note: the return type is intentionally the inferred shape — Electric's
 * `ShapeStreamOptions<T>` is opaque about extensions, and consuming code spreads
 * the result before handing it to `electricCollectionOptions`, so the structural
 * shape is what matters at the call sites.
 */
export interface ElectricShapeBaseOptions {
  url: string
  columnMapper: ReturnType<typeof snakeCamelMapper>
  onError: ReturnType<typeof shapeOnError>
  parser: typeof electricDateParsers
}

export function electricShapeOptionsFor(table: string): ElectricShapeBaseOptions {
  return {
    url: shapeUrl(table),
    columnMapper: snakeCamelMapper(),
    onError: shapeOnError(table),
    parser: electricDateParsers,
  }
}

/**
 * Subscribe to Electric shape changes on a table and auto-invalidate
 * query-based collections when data changes. Used for collections whose
 * row types require server-side JOINs/computations that can't be expressed
 * as a single-table Electric shape.
 *
 * Multiple calls for the same table accumulate query keys — the single
 * underlying ShapeStream invalidates all registered keys on change.
 */
const activeSubscriptions = new Map<string, { keys: (readonly string[])[] }>()

// Coalesces invalidations across all subscribers within a 50ms window so
// that when multiple Electric shape streams tick within ~50ms of each other,
// each unique query key is only invalidated once.
export const __INVALIDATION_DEBOUNCE_MS__ = 50

interface PendingEntry {
  keys: Set<string>
  timer: ReturnType<typeof setTimeout> | null
}

const pendingInvalidations = new Map<QueryClient, PendingEntry>()

function scheduleInvalidation(queryClient: QueryClient, key: readonly string[]) {
  let pending = pendingInvalidations.get(queryClient)
  if (!pending) {
    pending = { keys: new Set<string>(), timer: null }
    pendingInvalidations.set(queryClient, pending)
  }
  pending.keys.add(JSON.stringify(key))
  if (pending.timer === null) {
    pending.timer = setTimeout(() => {
      const entry = pendingInvalidations.get(queryClient)
      if (!entry) return
      const snapshot = entry.keys
      pendingInvalidations.delete(queryClient)
      for (const serialized of snapshot) {
        queryClient.invalidateQueries({ queryKey: JSON.parse(serialized) as unknown[] })
      }
    }, __INVALIDATION_DEBOUNCE_MS__)
  }
}

export function subscribeToTableChanges(
  table: string,
  queryClient: QueryClient,
  queryKeysToInvalidate: readonly (readonly string[])[]
) {
  if (typeof window === "undefined") return

  const existing = activeSubscriptions.get(table)
  if (existing) {
    // Accumulate new keys into the existing subscription
    existing.keys.push(...queryKeysToInvalidate)
    return
  }

  const state = { keys: [...queryKeysToInvalidate] }
  activeSubscriptions.set(table, state)

  const stream = new ShapeStream({
    url: shapeUrl(table),
    onError: shapeOnError(table),
  })

  // Skip the initial sync (we already have data from queryFn).
  // Only invalidate on live changes after the initial sync completes.
  let initialSyncDone = false

  stream.subscribe(
    (messages) => {
      if (!initialSyncDone) {
        // Check if initial sync is complete
        const hasUpToDate = messages.some(
          (m) => "headers" in m && "control" in m.headers && m.headers.control === "up-to-date"
        )
        if (hasUpToDate) initialSyncDone = true
        return
      }

      // Skip control/heartbeat batches (e.g. up-to-date, must-refetch). Only
      // actual row changes should trigger downstream invalidations — otherwise
      // upstream proxy hiccups produce a flood of pointless server-action calls.
      if (!messages.some(isChangeMessage)) return

      // Live change detected — schedule coalesced invalidation for each key
      for (const key of state.keys) {
        scheduleInvalidation(queryClient, key)
      }
    },
    (err) => {
      // Subscriber error callback — never let it bubble out as an unhandled
      // rejection. Logging is enough; the stream's onError above handles retry.
      console.warn(`[electric] subscriber error on "${table}":`, err)
    }
  )
}
