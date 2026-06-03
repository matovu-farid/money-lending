"use client"

import type { QueryClient } from "@tanstack/react-query"

/**
 * In-process replacement for the Electric `subscribeToTableChanges` API.
 *
 * The old implementation tapped Electric shape streams to learn when a
 * database row had changed; we no longer have that real-time stream, so
 * the mutation paths now explicitly call `emitTableChange(table)` after a
 * successful server write. Subscribers (declared by per-domain query
 * collections like dashboard, reports, daily-collections) get their
 * registered query keys invalidated and TanStack Query refetches.
 *
 * The same coalescing-via-50ms-window behaviour from the Electric version
 * is preserved so a burst of writes within one tick collapses into a
 * single invalidation per (queryClient, queryKey) pair.
 */

interface Subscription {
  queryClient: QueryClient
  keys: (readonly string[])[]
}

const subscriptions = new Map<string, Subscription[]>()

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

/**
 * Register a set of TanStack Query keys to invalidate whenever
 * `emitTableChange(table)` fires. Call this at module level in a
 * collection file (it runs once per browser session).
 */
export function subscribeToTableChanges(
  table: string,
  queryClient: QueryClient,
  queryKeysToInvalidate: readonly (readonly string[])[],
): void {
  if (typeof window === "undefined") return
  let existing = subscriptions.get(table)
  if (!existing) {
    existing = []
    subscriptions.set(table, existing)
  }
  existing.push({ queryClient, keys: [...queryKeysToInvalidate] })
}

/**
 * Notify subscribers that `table` has been written to. Called from
 * collection mutation handlers after the server action succeeds.
 *
 * No-op on the server (subscriptions live on the client).
 */
export function emitTableChange(table: string): void {
  if (typeof window === "undefined") return
  const subs = subscriptions.get(table)
  if (!subs) return
  for (const { queryClient, keys } of subs) {
    for (const key of keys) {
      scheduleInvalidation(queryClient, key)
    }
  }
}

/** For tests only — clears all registered subscriptions + pending timers. */
export function __resetTableEventsForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetTableEventsForTests must not be called in production")
  }
  subscriptions.clear()
  for (const entry of pendingInvalidations.values()) {
    if (entry.timer !== null) clearTimeout(entry.timer)
  }
  pendingInvalidations.clear()
}
