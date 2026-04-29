# Client-side caching fixes — implementation plan (v2, post-review)

Fixes derived from a review of `src/lib/query-client.ts`, `src/components/providers.tsx`, and the collection layer (`src/collections/*`). Goal: stop money-on-the-line bugs from default retries, stop wasteful refetches, stop unbounded memory growth, and add an idle-time data prefetch that isn't a memory wart.

Pre-production stance applies (per `project_pre_production_stance.md`): prefer correctness over backwards-compat. Refactors welcome.

> Review iteration v2: addressed reviewer findings on (a) auth-non-Electric collections needing window-focus override, (b) `creditors` family in persistence skip list, (c) atomic deletion sequencing for Task 4, (d) reusing the existing `boundedSet` helper instead of creating a parallel LRU abstraction, (e) auth-gating concrete implementation for the idle prefetcher, (f) adding a unit test for the new `onEvict` callback. Reviewer was incorrect about Task 7 export names — confirmed singular (`loanCollection`, etc.) via grep.

---

## Task 1 — Disable mutation retries (CRITICAL — money safety)

**File**: `src/lib/query-client.ts`

**Why**: TanStack Query's default `retry: 3` for mutations means on a flaky network, server-action mutations can fire 2–3× before reporting failure. Server actions return structured `{ error }` objects, but those are *not* what triggers retry — TCP failures and 5xx HTTP errors are, and those happen *before* the action's idempotency logic runs. Result: duplicate payments. For a lending app this is unacceptable.

**Change**:
```ts
new QueryClient({
  defaultOptions: {
    queries: { /* see Task 2 */ },
    mutations: { retry: false },
  },
})
```

**Verify**: 
- The codebase has no `useMutation` call sites (TanStack DB transactions handle mutations) — but `QueryCollectionConfig` accepts a per-collection `retry` field that *would* override this. Grep `retry:` inside `src/collections/` to confirm no collection sets one.
- `pnpm tsc --noEmit` after change.

**Risk**: Mutations will surface transient network errors to the user immediately. That's the correct behavior for money-moving operations — let the user retry deliberately.

---

## Task 2 — Tune query defaults + per-collection overrides for non-Electric auth data

**Files**:
- `src/lib/query-client.ts`
- `src/collections/loan-extras.ts` (currentUserRoleCollection)
- `src/collections/permissions.ts`
- `src/collections/admin-users.ts`

> Note: `invitationCollection`, `delegationCollection`, and `rateChangeRequestsCollection` use `electricCollectionOptions` (verified via grep) — they're already getting live invalidation from Electric, no override needed.

**Why**:
- `refetchOnWindowFocus: true` (default) refetches every active query on tab focus. Electric pushes live changes for synced tables; window-focus refetch is wasteful duplicate work for those.
- `gcTime: 5 * 60_000` collects cache 5 minutes after a query unmounts. Bump to 30 min so navigation-back is cache-fast.
- BUT: not everything is Electric-backed. `currentUserRoleCollection`, `permissionsCollection`, `adminUserCollection`, `invitationCollection`, `delegationCollection` have no Electric subscription. With `refetchOnWindowFocus: false` globally, a tab where an admin's permissions were just revoked could continue showing privileged buttons until the user navigates. That's a security-adjacent UX bug. For these specific collections, opt back into `refetchOnWindowFocus: true` AND set `staleTime: 30_000` to limit damage.

**Global change** (`src/lib/query-client.ts`):
```ts
queries: {
  staleTime: 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: false,
}
```

**Per-collection override** for the auth/permission collections listed above. NOTE: `QueryCollectionConfig` only exposes `{enabled, refetchInterval, retry, retryDelay, staleTime}` — it does NOT accept `refetchOnWindowFocus`. So we rely on a short `staleTime` only:
```ts
queryCollectionOptions({
  /* ...existing... */
  staleTime: 30_000,
})
```
Trade-off: a tab whose role was revoked will not refetch on window focus, only when a `useLiveQuery` observer remounts and sees stale-after-30s. Server enforces actual permissions, so this is UI freshness only.

**Risk**: Returning to a tab won't pull fresh non-auth data until staleTime elapses or Electric pushes a change. Acceptable — Electric is the authority for changeful data, and auth/permission data has the explicit override.

---

## Task 3 — Bump persister maxAge + dehydration filter (with creditors family)

**File**: `src/components/providers.tsx`

**Why**:
- `maxAge: 5 * 60_000` (5 min) wipes the persisted cache when a user returns from lunch. For an offline-tolerant lending app, 24h is reasonable. The `buster` cache-version key already guards against schema changes.
- localStorage has a 5–10 MB origin quota. Persisting *everything* — PnL reports, balance sheets, transaction reports, dashboard activity, plus creditor-dashboard for every visited creditor — risks blowing the quota silently (the persister `setItem` fails quietly and the cache stops persisting). Filter out large/derived/per-id data.

**Change**:
```ts
persistOptions={{
  persister,
  maxAge: 24 * 60 * 60 * 1000,
  buster: "v5-tanstack-db",   // bump because semantics changed
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      const head = query.queryKey[0]
      // Skip large/derived data and per-id collections that grow O(n) with usage.
      const skip = new Set([
        "reports",          // pnl/balance-sheet/portfolio/retained-earnings/transactions
        "activities",       // paginated, large
        "dashboard",        // dashboard.kpis + dashboard.activity, both auto-revalidated
        "loans-due-today",  // auto-revalidated daily
        "daily-collections",// per-date entries, grows
        "creditors",        // covers per-id ["creditors", id, ...] entries
      ])
      return typeof head !== "string" || !skip.has(head)
    },
  },
}}
```

**Verify**: Skip-list strings match the `[0]` segment of all `queryKeys.*` factories in `src/lib/query-keys.ts`. Confirmed: `reports.*` → `"reports"`, `activities.*` → `"activities"`, `dashboard.*` → `"dashboard"`, `loans.dueToday` → `"loans-due-today"`, `dailyCollections.*` → `"daily-collections"`, `creditors.*` → `"creditors"`.

**Risk**: Reports/dashboard/creditor-detail pages land empty on first paint after a fresh session — but that was already the case with the 5-min maxAge for any user returning > 5 min later. The skipped keys are also the ones backed by Electric live invalidation or fast aggregates, so the round-trip is fast.

---

## Task 4 — Delete dead `src/hooks/query-keys.ts` (atomic)

**Files**:
- Delete `src/hooks/query-keys.ts`
- Delete `src/hooks/__tests__/query-keys.test.ts`

**Why**: 0 production importers (`grep -r 'from "@/hooks/query-keys"' src` returns nothing). The canonical factory is `src/lib/query-keys.ts` (19 importers). The dead file already drifts from the live one.

**Sequencing note**: The test file imports from `"../query-keys"` (relative), so deleting only the source mid-task would break `pnpm vitest run`. Use a single atomic command:

```bash
git rm src/hooks/query-keys.ts src/hooks/__tests__/query-keys.test.ts
```

**Verify**: `grep -rln "@/hooks/query-keys\|hooks/query-keys" src/` returns nothing; `pnpm tsc --noEmit` passes; `pnpm vitest run` passes.

**Risk**: None.

---

## Task 5 — Per-collection staleTime for reference data

**Files**:
- `src/collections/expense-categories.ts`
- `src/collections/income-categories.ts`
- `src/collections/loan-extras.ts` — `collateralNaturesCollection` only (locationBalancesCollection ALREADY has `staleTime: 30_000`; leave it alone)
- `src/collections/bank-accounts.ts`

**Why**: Default 60s `staleTime` causes these to refetch every minute despite changing maybe daily (categories) or weekly (bank accounts) or never (collateral natures). They're not Electric-backed and won't auto-update from a stream.

**Change**: Add `staleTime: 60 * 60 * 1000` (1 hour) on each. Don't use `Infinity` — these *do* change occasionally and no other invalidation path exists.

**Risk**: Up to 1h staleness on reference data. Acceptable; admins know to refresh after editing.

---

## Task 6 — Bound and clean up per-id collection caches (memory leak)

**Files**:
- `src/lib/bounded-map.ts` — extend with `onEvict` callback (do NOT create a parallel LRU helper; the reviewer rightly flagged that `boundedSet` already exists)
- `src/lib/__tests__/bounded-map.test.ts` — NEW test file for the eviction callback
- `src/collections/loan-balance.ts` — convert plain Map → boundedSet+evict
- `src/collections/activities.ts` — convert plain Map → boundedSet+evict (and remove the now-stale "bounded only by distinct filter+page combos" comment)
- `src/collections/loan-extras.ts` — 4 plain Maps (`userNameMapCollections`, `loanCollateralCollections`, `activeLoanCheckCollections`, `paymentPortionsCollections`) → bounded+evict
- `src/collections/creditor-extras.ts` — already uses `boundedSet`; add evict callback
- `src/collections/reports.ts` — already uses `boundedSet`; add evict callback
- `src/collections/daily-collections.ts` — already uses `boundedSet`; add evict callback

**Why**: Each `getXxxCollection(id)` lazily creates a TanStack DB collection and stores it in a module-level Map. Many use `startSync: true` — meaning the collection keeps polling/syncing forever even after the user has navigated away. No eviction (or eviction without cleanup) means subscriptions leak indefinitely.

**Confirmed via type inspection**:
- `CollectionImpl.cleanup(): void` — exists, synchronous, returns void (per `node_modules/.pnpm/@tanstack+db@0.6.5_*/.../collection/lifecycle.d.ts` line 79).
- The reviewer thought it was async; it's not.

**API change to `boundedSet`**:
```ts
// src/lib/bounded-map.ts
export function boundedSet<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxSize: number,
  onEvict?: (evictedValue: V) => void,
): void {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value
    if (firstKey !== undefined) {
      const evicted = map.get(firstKey)
      map.delete(firstKey)
      if (evicted !== undefined && onEvict) onEvict(evicted)
    }
  }
  map.set(key, value)
}
```

Then at every call site, pass `(c) => c.cleanup()` as the `onEvict`. Capacity stays as-is for sites that already had one (32 in most places); set new sites to 32.

**Test** (`src/lib/__tests__/bounded-map.test.ts`):
- Inserting up to capacity does not evict.
- Inserting at capacity+1 evicts the oldest entry.
- `onEvict` is called with the evicted value.
- `onEvict` is NOT called when no eviction happens.
- `onEvict` is optional (no callback → no error).

**Risk**: If a component still holds a reference to an evicted collection, reads continue to return last-known data but `cleanup()` will have stopped the sync, so future updates won't arrive. With capacity 32 this should never happen in practice (worst case: evicted collection's component remounts and re-creates a fresh one).

---

## Task 7 — Idle-time data prefetch for top-level collections (auth-gated)

**Files**:
- `src/lib/idle-prefetch.ts` — NEW
- `src/components/providers.tsx` — render a new `<IdlePrefetcher />` child component
- `src/components/idle-prefetcher.tsx` — NEW; `useSession`-gated component that fires the prefetch effect only after auth resolves

**Why**: Memory `feedback_performance_patterns` claims "sidebar eager prefetch" but the sidebar only does Next.js `router.prefetch` on hover (route bundle, not data). True data prefetch on hover is dangerous — accidental touches trigger N collection startups, racing with the user's actual click. Better: warm the most-likely-next-pages' collections during browser idle time *after* the current page has settled AND auth is established.

**Confirmed via type inspection**:
- `CollectionImpl.preload(): Promise<void>` exists (per `collection/index.d.ts` line 193).
- Calling `preload()` on an already-syncing collection is a no-op (it short-circuits via `preloadPromise`).

**Implementation**:

```ts
// src/lib/idle-prefetch.ts
type IdleCb = (deadline: IdleDeadline) => void

const ric: (cb: IdleCb, opts?: { timeout: number }) => number =
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? window.requestIdleCallback.bind(window)
    : (cb) => window.setTimeout(
        () => cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline),
        1,
      )

let scheduled = false

export function scheduleIdlePrefetch(): void {
  if (typeof window === "undefined" || scheduled) return
  scheduled = true
  ric(
    async () => {
      const mods = await Promise.all([
        import("@/collections/loans"),
        import("@/collections/customers"),
        import("@/collections/payments"),
        import("@/collections/dashboard"),
        import("@/collections/bank-accounts"),
      ])
      const collections = [
        mods[0].loanCollection,
        mods[1].customerCollection,
        mods[2].paymentCollection,
        mods[3].dashboardCollection,
        mods[4].bankAccountCollection,
      ]
      // Fire-and-forget; preload() is idempotent and self-retrying via the
      // collection's own error handling.
      for (const c of collections) {
        void c?.preload?.()
      }
    },
    { timeout: 4000 },
  )
}
```

```tsx
// src/components/idle-prefetcher.tsx
"use client"
import { useEffect } from "react"
import { useSession } from "@/lib/auth-client"
import { scheduleIdlePrefetch } from "@/lib/idle-prefetch"





**Out-of-scope side notes**:
- `recentCategoryNames` plain Maps in `src/collections/income.ts` and `src/collections/expenses.ts` are *string* caches, not collection caches. They hold no live sync subscriptions, so eviction does not apply. Explicitly out of scope for Task 6.
**Why not a Worker**: TanStack DB collections live in the main thread bound to React. A Worker can't help here; `requestIdleCallback` already gives "yield until the browser has nothing else to do."



**Verify**: Open Network tab in dev, log in. After login completes and the dashboard renders, observe a small batch of additional shape/action requests fired during the next idle window (typically <1s).


## Task 8 — Update memory `feedback_performance_patterns`

**File**: `~/.claude/projects/-Users-faridmatovu-projects-money-lending/memory/feedback_performance_patterns.md`


**Risk**: None.

---

## Implementation order + parallelism (revised)

| Wave | Tasks | Why this order |
|------|-------|----------------|
| 1 | 1, 2, 3, 5 | All independent of each other except Task 2 + Task 5 collide on `loan-extras.ts` (the auth-collections override and `collateralNaturesCollection` staleTime). Task 1 is one line. Tasks 2 + 5 mostly touch different files except for `loan-extras.ts`; merge into a single edit there. Single safety-fix commit. |
| 2 | 4 | Independent atomic deletion. Run in parallel with Wave 1. |
| 3 | 6 (test first, then conversions) | Touches many collection files. Must run after Wave 1 because the staleTime/refetch overrides land first. Per-collection edits parallelize cleanly across non-overlapping files. Wave 3a: extend `boundedSet` + add tests. Wave 3b: convert call sites. |
| 4 | 7 | New files; depends on collection exports being clean (Wave 3 done). |
| 5 | 8 | Memory text update. |

After **each** task: spawn a `feature-dev:code-reviewer` subagent on the diff with task-specific context. Iterate on review feedback until clean before moving to the next task.

---

## Verification checklist (after all tasks)

- `pnpm tsc --noEmit` — no type errors.
- `pnpm vitest run` — all unit tests pass, including the new `bounded-map.test.ts`.
- `pnpm next build` — production build succeeds.
- Manual: open dev, switch tabs back and forth — Network tab shows no refetch fan-out except auth-permission collections.
- Manual: localStorage `react-query-cache` populated post-navigation; no quota errors in console; key sizes spot-checked (no `reports`/`creditors` entries).
- Manual: load `/loans/<id>` → navigate away → return — balance loads from cache without a network round trip.
- Manual: log in fresh; observe one idle-window prefetch burst in Network tab; subsequent navigations hit warm cache.
