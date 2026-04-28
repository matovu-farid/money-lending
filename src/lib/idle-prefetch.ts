"use client"

/**
 * Warm the cache for top-level navigation targets during browser idle time.
 *
 * Why this exists: a "sidebar eager prefetch on hover" approach is fragile
 * (accidental hovers thrash the network) and a synchronous "prefetch on
 * mount" delays first paint. requestIdleCallback fires only when the main
 * thread has nothing else to do, so the prefetch never competes with
 * user-visible work.
 *
 * Note: this fires once per *page load* (module-level `scheduled` flag).
 * If a user logs out and logs back in within the same tab without a
 * reload, prefetch will not re-fire. That's acceptable for pre-production;
 * the warm cache from the previous session is still valid for shared data.
 */

type IdleCb = (deadline: IdleDeadline) => void

// Use the global `setTimeout` rather than `window.setTimeout` so the module
// can safely load under SSR (the module IS bundled for the server too — even
// though its callbacks won't fire there since `scheduleIdlePrefetch` early-
// returns on `typeof window === "undefined"`, the binding still gets created
// at import time and `window.setTimeout` would be a hazard).
const ric: (cb: IdleCb, opts?: { timeout: number }) => number =
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? (cb, opts) => window.requestIdleCallback(cb, opts)
    : (cb) =>
        setTimeout(
          () =>
            cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline),
          1,
        ) as unknown as number

let scheduled = false

export function scheduleIdlePrefetch(): void {
  if (typeof window === "undefined" || scheduled) return
  scheduled = true
  ric(
    () => {
      // Fire-and-forget. preload() on TanStack DB collections is idempotent
      // (returns the in-flight promise if a sync is already running). Log
      // import / preload failures so a chunk-hash mismatch after a deploy
      // doesn't disappear silently into the void.
      runPrefetch().catch((err) => {
        console.warn("[idle-prefetch] failed:", err)
      })
    },
    { timeout: 4000 },
  )
}

async function runPrefetch(): Promise<void> {
  const [
    { loanCollection },
    { loanBalanceCollection },
    { customerCollection },
    { paymentCollection },
    { dashboardCollection },
    { bankAccountCollection },
  ] = await Promise.all([
    import("@/collections/loans"),
    import("@/collections/loan-balances"),
    import("@/collections/customers"),
    import("@/collections/payments"),
    import("@/collections/dashboard"),
    import("@/collections/bank-accounts"),
  ])
  for (const c of [
    loanCollection,
    loanBalanceCollection,
    customerCollection,
    paymentCollection,
    dashboardCollection,
    bankAccountCollection,
  ]) {
    void c.preload()
  }
}
