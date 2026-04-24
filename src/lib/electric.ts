"use client"

import { ShapeStream } from "@electric-sql/client"
import type { QueryClient } from "@tanstack/react-query"

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
 * Subscribe to Electric shape changes on a table and auto-invalidate
 * query-based collections when data changes. Used for collections whose
 * row types require server-side JOINs/computations that can't be expressed
 * as a single-table Electric shape.
 *
 * Multiple calls for the same table accumulate query keys — the single
 * underlying ShapeStream invalidates all registered keys on change.
 */
const activeSubscriptions = new Map<string, { keys: (readonly string[])[] }>()

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
  })

  // Skip the initial sync (we already have data from queryFn).
  // Only invalidate on live changes after the initial sync completes.
  let initialSyncDone = false

  stream.subscribe((messages) => {
    if (!initialSyncDone) {
      // Check if initial sync is complete
      const hasUpToDate = messages.some(
        (m) => "headers" in m && "control" in m.headers && m.headers.control === "up-to-date"
      )
      if (hasUpToDate) initialSyncDone = true
      return
    }

    // Live change detected — invalidate ALL registered query keys for this table
    for (const key of state.keys) {
      queryClient.invalidateQueries({ queryKey: [...key] })
    }
  })
}
