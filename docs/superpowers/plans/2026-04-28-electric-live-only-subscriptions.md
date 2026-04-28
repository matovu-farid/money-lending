# Eliminate Duplicate Electric ShapeStreams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop downloading and discarding initial Electric snapshots in `subscribeToTableChanges`. The function should attach to the existing live-change stream without replaying the snapshot, eliminating duplicate snapshot bandwidth and CPU on cold start.

**Architecture:** Today, every call to `subscribeToTableChanges(table, ...)` (`src/lib/electric.ts:85`) opens a fresh `ShapeStream` that downloads the entire shape snapshot (which the function then ignores via the `initialSyncDone` guard at `src/lib/electric.ts:107-119`). For tables that are also backed by an `electricCollectionOptions` collection, this is doubly wasteful — the same snapshot is already being fetched and used by the collection. The fix: pass Electric protocol params (`live=true`, `offset=-1`, `handle=...`) to make the ShapeStream skip the initial-sync phase. The current `initialSyncDone` guard then becomes redundant, but we keep it as a safety belt because the API allows the server to send a snapshot in some edge cases (handle invalidation, must-refetch). Existing call-site behavior is preserved: same invalidation semantics, same coalescing window, same `up-to-date`/`must-refetch`/heartbeat handling.

**Tech Stack:** TypeScript, `@electric-sql/client@1.5.15`, `@tanstack/react-query`, Vitest (jsdom), Cypress.

---

## File Structure

- **Modify:** `src/lib/electric.ts` — change `ShapeStream` constructor opts to opt into live-only mode.
- **Modify:** `src/lib/electric.test.ts` — extend the existing fake `ShapeStream` to capture constructor params, and add tests asserting the live-only params are passed.
- **Modify:** `cypress/e2e/dashboard.cy.ts` — add one assertion that confirms the Electric-driven dashboard still updates after a write (regression guard for the refactor).

No new files. The change is internal to `src/lib/electric.ts` and its test.

---

## Task 1: Research spike — confirm `@electric-sql/client` ShapeStream live-only params

**Files:**
- Read-only: `node_modules/@electric-sql/client/dist/cjs/client.d.ts` (or `.js` if needed)
- Read-only: `src/lib/electric.ts:102-105`

- [ ] **Step 1: Read the ShapeStream constructor signature**

Run: `grep -nE "ShapeStreamOptions|class ShapeStream|params\??:" node_modules/@electric-sql/client/dist/cjs/client.d.ts | head -40`

Expected: a `ShapeStreamOptions` interface that includes a `params` field (or equivalent) accepting arbitrary key/value pairs that get forwarded as URL query params to the shape endpoint. Confirm presence of:
- `params?: Record<string, string>` or similar
- Acceptance of `live`, `offset`, `handle` (Electric protocol query params)

If the field is named differently in this version, note the actual name (e.g. `searchParams`, `extraParams`) and use that throughout the rest of the plan.

- [ ] **Step 2: Confirm the proxy forwards Electric protocol params**

Read: `src/app/api/electric/[...table]/route.ts:122-127`

Confirm: the existing `ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)` filter forwards all params Electric sends. This means `live`, `offset`, `handle` already pass through. No proxy change needed.

- [ ] **Step 3: Note the conclusion**

Write a one-paragraph note to yourself (do NOT commit a file): "ShapeStreamOptions exposes `params` (or whichever name was found) accepting `Record<string, string>`. Live-only mode is opt-in via `params: { live: 'true', offset: '-1' }`. Proxy already forwards these. Proceeding with Task 2."

If the ShapeStream API does NOT expose a way to pass arbitrary params, STOP and report back. The fallback is to construct the URL with query params manually and pass it via `url:` to ShapeStream — but that's only a viable fallback if the client doesn't strip them. Verify before pivoting.

---

## Task 2: Write failing test — live-only constructor params

**Files:**
- Modify: `src/lib/electric.test.ts:22-57` (extend the `ShapeStream` mock to capture `params`)
- Modify: `src/lib/electric.test.ts` (add new test under the existing `describe`)

- [ ] **Step 1: Extend the FakeStream type and mock to capture `params`**

In `src/lib/electric.test.ts`, modify the `FakeStream` interface and the mock class to record the constructor options:

```ts
interface FakeStream {
  url: string
  params: Record<string, string> | undefined
  messageHandler: MessageHandler | null
  errorHandler: ErrorHandler | null
  emit: (messages: unknown[]) => void
}

// Inside vi.mock("@electric-sql/client", ...):
ShapeStream: class {
  url: string
  params: Record<string, string> | undefined
  messageHandler: MessageHandler | null = null
  errorHandler: ErrorHandler | null = null
  constructor(opts: { url: string; params?: Record<string, string> }) {
    this.url = opts.url
    this.params = opts.params
    const fake: FakeStream = {
      url: opts.url,
      params: opts.params,
      messageHandler: null,
      errorHandler: null,
      emit: (messages: unknown[]) => {
        this.messageHandler?.(messages)
      },
    }
    streams.push(fake)
    ;(this as unknown as { _fake: FakeStream })._fake = fake
  }
  // subscribe() unchanged from existing test file
  subscribe(messageHandler: MessageHandler, errorHandler: ErrorHandler) {
    this.messageHandler = messageHandler
    this.errorHandler = errorHandler
    const fake = (this as unknown as { _fake: FakeStream })._fake
    fake.messageHandler = messageHandler
    fake.errorHandler = errorHandler
    fake.emit = (messages: unknown[]) => messageHandler(messages)
  }
},
```

(If the spike in Task 1 found a different param-field name, substitute it everywhere the word `params` appears below.)

- [ ] **Step 2: Add a new test asserting live-only params are passed**

Append at the bottom of the existing `describe("subscribeToTableChanges — coalesced invalidation", ...)` block (after the "ticks arriving >50ms apart" test at `src/lib/electric.test.ts:271-297`):

```ts
  it("opens the ShapeStream in live-only mode (no initial snapshot)", async () => {
    const { subscribeToTableChanges } = await loadFreshModule()
    const { client } = makeQueryClient()

    subscribeToTableChanges("loans", client, [["dashboard", "kpis"] as const])

    expect(streams).toHaveLength(1)
    expect(streams[0].params).toMatchObject({
      live: "true",
      offset: "-1",
    })
  })
```

- [ ] **Step 3: Run the new test — verify it fails**

Run: `pnpm vitest run src/lib/electric.test.ts -t "live-only mode"`

Expected: FAIL with `expected undefined to match object { live: "true", offset: "-1" }` (because the production code doesn't pass `params` yet).

- [ ] **Step 4: Commit the failing test**

```bash
git add src/lib/electric.test.ts
git commit -m "test(electric): add failing test for live-only ShapeStream params"
```

---

## Task 3: Implement live-only ShapeStream construction

**Files:**
- Modify: `src/lib/electric.ts:102-105`

- [ ] **Step 1: Update the ShapeStream constructor call**

Replace `src/lib/electric.ts:102-105`:

```ts
  const stream = new ShapeStream({
    url: shapeUrl(table),
    onError: shapeOnError(table),
  })
```

with:

```ts
  // Live-only mode: skip the initial snapshot.
  //
  // We use this stream purely for change-notification → query invalidation;
  // the snapshot data is discarded by the `initialSyncDone` guard below.
  // `offset: "-1"` resumes from the latest known position; `live: "true"`
  // enables the long-poll change channel. Together they tell Electric we
  // only want forward-going deltas, not the historical replay.
  //
  // Tables that ARE also backed by an `electricCollectionOptions` collection
  // (payments, customers, transactions, fund_transfers, creditor_*) keep their
  // own ShapeStream for the snapshot — this stream is the *additional* one
  // that today wastes a snapshot download.
  const stream = new ShapeStream({
    url: shapeUrl(table),
    onError: shapeOnError(table),
    params: {
      live: "true",
      offset: "-1",
    },
  })
```

(If the spike found a different field name in Task 1, substitute it.)

- [ ] **Step 2: Run the new test — verify it passes**

Run: `pnpm vitest run src/lib/electric.test.ts -t "live-only mode"`

Expected: PASS.

- [ ] **Step 3: Run the full electric.test.ts suite — verify no regression**

Run: `pnpm vitest run src/lib/electric.test.ts`

Expected: all 9 existing tests + 1 new test PASS.

The existing tests pass because the `initialSyncDone` guard (`src/lib/electric.ts:107-119`) is preserved — even with live-only mode, the server can still emit an `up-to-date` control message (e.g. on handle invalidation), and the guard correctly treats that as the boundary between "ignored history" and "live changes". The mock test setup feeds `upToDateMessage` followed by `liveChange`, which exercises exactly this path.

- [ ] **Step 4: Commit**

```bash
git add src/lib/electric.ts
git commit -m "fix(electric): skip initial snapshot in subscribeToTableChanges

Pass live=true&offset=-1 to ShapeStream so the change-notification
streams (used for invalidation only) don't redownload table snapshots
that are either already cached by an Electric collection or never
consumed at all. Eliminates duplicate snapshot bandwidth on cold start
for: loans, payments, transactions, fund_transfers, creditor_investments,
creditor_repayments. Invalidation semantics unchanged."
```

---

## Task 4: Add a regression test that exercises the live-change path end-to-end

**Files:**
- Modify: `src/lib/electric.test.ts` (add one more test — the existing tests cover behavior, this one covers the URL contract)

- [ ] **Step 1: Add a test asserting the URL is unchanged**

Append after the test added in Task 2:

```ts
  it("opens the ShapeStream against the proxied table URL", async () => {
    const { subscribeToTableChanges } = await loadFreshModule()
    const { client } = makeQueryClient()

    subscribeToTableChanges("payments", client, [["dashboard", "kpis"] as const])

    expect(streams).toHaveLength(1)
    expect(streams[0].url).toContain("/api/electric/payments")
  })
```

- [ ] **Step 2: Run the new test**

Run: `pnpm vitest run src/lib/electric.test.ts -t "proxied table URL"`

Expected: PASS (the production code already does this; the test is a regression guard).

- [ ] **Step 3: Commit**

```bash
git add src/lib/electric.test.ts
git commit -m "test(electric): add regression test for ShapeStream URL contract"
```

---

## Task 5: Add a Cypress regression test for live invalidation after a write

**Files:**
- Modify: `cypress/e2e/dashboard.cy.ts:55-...` (the existing "shows activity feed after issuing a loan" test already exercises the live-update path; we tighten it with a stronger assertion)

- [ ] **Step 1: Read the existing test**

Read `cypress/e2e/dashboard.cy.ts` from line 55 to the end of the `it("shows activity feed after issuing a loan", ...)` block. Note the current assertion that the activity feed contains the new loan event.

- [ ] **Step 2: Tighten the assertion to also verify a KPI updates**

The "Loans Outstanding" KPI is invalidated via `subscribeToTableChanges("loans", ...)` from `src/collections/dashboard.ts:12`. After issuing a loan, this KPI must update from `UGX 0` to a non-zero value. Add this assertion at the END of the existing `it("shows activity feed after issuing a loan", ...)` block, before the closing `})`:

```ts
    // Verify the live-invalidation pipeline still works after the
    // electric.ts refactor: issuing a loan triggers a payments/loans live
    // change, which invalidates ["dashboard", "kpis"], which refetches the
    // KPI server action. The "Loans Outstanding" card should now be > 0.
    cy.visit("/dashboard")
    cy.contains("Loans Outstanding")
      .closest("[data-slot=card]")
      .should("not.contain", "UGX 0")
      .should("contain", "UGX 500,000")
```

(`UGX 500,000` because the existing test issues a 500000 principal loan.)

- [ ] **Step 3: Run the Cypress test**

Run: `pnpm cypress run --spec cypress/e2e/dashboard.cy.ts --headless`

Expected: all dashboard tests PASS, including the tightened "shows activity feed after issuing a loan" test which now also verifies the KPI live-update.

If this test fails, the refactor broke the live-invalidation pipeline — STOP, do NOT commit Tasks 5+, and revert Task 3's commit while you investigate.

- [ ] **Step 4: Commit**

```bash
git add cypress/e2e/dashboard.cy.ts
git commit -m "test(cypress): tighten dashboard test to verify Electric live KPI update"
```

---

## Task 6: Final verification

**Files:** none

- [ ] **Step 1: Run the full unit test suite**

Run: `pnpm test:unit`

Expected: all tests PASS.

- [ ] **Step 2: Run the full Cypress E2E suite**

Run: `pnpm test:e2e`

Expected: all Cypress specs PASS. Pay particular attention to specs that exercise live-update flows:
- `cypress/e2e/dashboard.cy.ts`
- `cypress/e2e/daily-collections.cy.ts`
- `cypress/e2e/activity-feed.cy.ts`
- `cypress/e2e/cross-role-interactions.cy.ts`

If any spec fails, the refactor has a regression — investigate before reporting completion.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: no errors.

- [ ] **Step 4: Verify the bandwidth win in dev (manual sanity check)**

Open the app in dev (`pnpm dev`), open browser DevTools → Network tab, filter by `/api/electric/`. Cold-load the dashboard. You should see Electric requests for tables that ARE Electric collections (`payments`, `customers`, etc.) returning a snapshot, but the requests originating from `subscribeToTableChanges` (which appear as additional concurrent requests to the same URLs) should now have `live=true&offset=-1` in the query string and return a much smaller payload (heartbeat only, no rows).

This is a sanity check, not a gate. Do NOT add it as a code-level test — Cypress already covers behavioral correctness.

- [ ] **Step 5: Final commit (only if any small docs/comments were missed)**

If everything is green and there's nothing to commit, skip this step. The plan is complete.

---

## Out of Scope (intentional)

- Migrating any collection from `queryCollectionOptions` to `electricCollectionOptions`. That's Plan B (`docs/superpowers/specs/2026-04-28-loans-electric-direct-design.md`).
- Removing `subscribeToTableChanges` entirely. We still need it for `loans` (no Electric collection backing it yet) and for cross-table invalidation (e.g., a `transactions` write invalidating `["dashboard", "kpis"]`).
- Touching the IdlePrefetcher. That's a separate question — see the discussion in conversation history. The conclusion was: it's correct as-is, naming aside.

## Risks

- **Electric protocol param API change**: if `@electric-sql/client@1.5.15` doesn't expose a `params` option on ShapeStream (or names it differently), the spike in Task 1 will catch it. Pivot to constructing the URL with query params and passing the full URL.
- **Server-side handle expiry**: `offset=-1` requires the Electric server to mint a new handle for the client. If the proxy or upstream Electric rejects "no prior handle + offset=-1", the stream will fail and the `shapeOnError` retry kicks in. This is the same retry path that already handles transient errors — no new risk.
- **Cypress flakiness**: the dashboard live-update assertion (Task 5) depends on the invalidation arriving within Cypress's default `cy.contains` retry window (4s). If flaky on CI, bump the timeout: `cy.contains("Loans Outstanding", { timeout: 10000 })`.
