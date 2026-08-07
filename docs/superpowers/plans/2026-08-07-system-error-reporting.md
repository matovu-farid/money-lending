# System Error Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure unexpected technical failures and operational warnings across the application are captured by Sentry without capturing expected business outcomes or leaking private data.

**Architecture:** Keep the existing Sentry SDK initialization and Next.js `onRequestError` fallback, and make `src/lib/sentry.ts` the safe application-level adapter. Make `withAction` capture technical failures even when it maps them to generic UI messages, then audit every inner catch in actions and shared best-effort helpers so original errors are reported before fallback responses are returned.

**Tech Stack:** Next.js 16 App Router, TypeScript, Effect, `@sentry/nextjs` 10, TanStack Query, Vitest, Cypress.

---

## File map

- Modify `src/lib/sentry.ts` — central exception/warning capture, unwrapping, safe context, and deduplication.
- Create `src/lib/__tests__/sentry.test.ts` — SDK-mocked tests for capture behavior and privacy.
- Modify `src/lib/with-action.ts` — classify expected domain failures separately from technical failures.
- Modify `src/lib/__tests__/with-action.test.ts` — prove technical Effect failures are captured while expected failures are not.
- Modify the server action modules listed in Task 3 — replace swallowed technical catches with captures using stable sources.
- Modify `src/actions/__tests__/payment.actions.test.ts` and `src/actions/__tests__/authorization.test.ts` — representative regression coverage.
- Modify `src/app/api/cron/*/route.ts` and `src/app/api/reports/*/route.ts` — ensure every caught technical failure reports once.
- Modify `src/lib/auth.ts`, `src/lib/email.ts`, `src/lib/ip-allowlist.ts`, `src/lib/interest/loanBalanceData.ts`, `src/collections/loans.ts`, and `src/lib/bounded-map.ts` — report degraded best-effort operations without changing fallback policy.
- Modify `src/lib/query-client.ts` — report client query/mutation transport failures with safe operation context.
- Modify `instrumentation-client.ts`, `sentry.server.config.ts`, and `sentry.edge.config.ts` — scrub exception/message text as well as request/context data.
- Modify `src/app/(app)/error.tsx` and `src/app/global-error.tsx` only if needed to add stable error-boundary tags; do not add duplicate browser listeners when Sentry’s default global handlers are active.
- Modify `cypress/e2e/*` only if an existing error-boundary smoke harness can exercise the fallback without adding a production-only failure route.

## Task 1: Establish the central capture contract

**Files:**
- Modify: `src/lib/sentry.ts`
- Create: `src/lib/__tests__/sentry.test.ts`

- [ ] **Step 1: Write failing SDK-mocked tests**

Mock `@sentry/nextjs` with `withScope`, `captureException`, and
`captureMessage`. Make the mocked `withScope` execute its callback with
tracked `setTag`, `setUser`, and `setContext` spies. Set `NODE_ENV` to
`production` and provide a DSN before loading the module. Cover these exact
behaviors:

```typescript
it("captures the underlying Error from a DatabaseError", () => {
  const cause = new Error("connection refused")
  captureServerError(new DatabaseError({ cause }), { source: "test" })

  expect(captureException).toHaveBeenCalledWith(cause)
  expect(captureMessage).not.toHaveBeenCalled()
})

it("captures typed non-Error failures as error messages with safe context", () => {
  captureServerError(
    { _tag: "UnexpectedFailure", detail: "safe diagnostic" },
    { source: "test", userId: "user-1", requestId: "req-1" },
  )

  expect(captureMessage).toHaveBeenCalledWith("Typed error: UnexpectedFailure", "error")
  expect(scopeSetUser).toHaveBeenCalledWith({ id: "user-1" })
  expect(scopeSetTag).toHaveBeenCalledWith("source", "test")
  expect(scopeSetContext).not.toHaveBeenCalled()
})

it("does not forward nested private values from typed errors or context", () => {
  captureServerError(
    {
      _tag: "UnexpectedFailure",
      email: "person@example.com",
      amount: "90000",
      nested: { token: "secret", customerName: "Private Person" },
    },
    { source: "test", email: "person@example.com", amount: "90000" },
  )

  expect(scopeSetContext).not.toHaveBeenCalled()
  for (const call of scopeSetTag.mock.calls) {
    expect(JSON.stringify(call)).not.toMatch(/person@example|90000|secret|Private Person/)
  }
})

it("captures operational warnings separately", () => {
  captureServerWarning("IP lookup failed", { source: "ip-allowlist" })
  expect(captureMessage).toHaveBeenCalledWith("IP lookup failed", "warning")
})

it("does not capture expected domain tags", () => {
  expect(isExpectedDomainError({ _tag: "ValidationError" })).toBe(true)
  expect(isExpectedDomainError({ _tag: "LoanNotFound" })).toBe(true)
  expect(isExpectedDomainError({ _tag: "DatabaseError" })).toBe(false)
  expect(isExpectedDomainError({ _tag: "UnexpectedFailure" })).toBe(false)
})

it("does not report the same object twice", () => {
  const error = new Error("same failure")
  captureServerError(error, { source: "inner" })
  captureServerError(error, { source: "outer" })
  expect(captureException).toHaveBeenCalledTimes(1)
})

it("never throws when the Sentry SDK throws", () => {
  captureException.mockImplementationOnce(() => { throw new Error("SDK down") })
  expect(() => captureServerError(new Error("application failure"))).not.toThrow()
})

it("classifies client transport failures without classifying user-facing errors", () => {
  expect(isTechnicalClientError(new TypeError("Failed to fetch"))).toBe(true)
  expect(isTechnicalClientError({ status: 503, message: "unavailable" })).toBe(true)
  expect(isTechnicalClientError(new Error("Unauthorized"))).toBe(false)
  expect(isTechnicalClientError(new Error("Invalid amount"))).toBe(false)
})
```

The test must initially fail because the new classifier and deduplicated
capture behavior do not yet exist.

- [ ] **Step 2: Run the focused test and verify the intended failure**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/sentry.test.ts
```

Expected: FAIL on missing `isExpectedDomainError`/deduplication behavior, not
on a test syntax or module-resolution error.

- [ ] **Step 3: Implement the minimal central adapter**

In `src/lib/sentry.ts`:

1. Reuse the existing production/DSN gate.
2. Import `getDiagnosticErrorCause` so `DatabaseError` and nested
   `FiberFailure` causes resolve to their original error.
3. Export `isExpectedDomainError(error: unknown): boolean` using the unwrapped
   `_tag` and this allowlist:

```typescript
const EXPECTED_DOMAIN_ERROR_TAGS = new Set([
  "ValidationError",
  "CustomerNotFound",
  "LoanNotFound",
  "PaymentNotFound",
  "CreditorNotFound",
  "InvestmentNotFound",
  "CategoryNotFound",
  "CategoryInUseError",
  "TransactionNotFound",
  "RateChangeRequestNotFound",
  "SnapshotNotFound",
  "ConversationNotFound",
  "MessageNotFound",
  "DuplicateError",
  "IncompleteLoanRequirements",
  "UnauthorizedError",
  "ForbiddenError",
  "ReceiptBlockedError",
  "InsufficientFundsError",
  "AlreadyMarkedWrong",
  "NotMarkedWrong",
])
```

`DatabaseError` is deliberately absent. Unknown tags are technical and are
captured by default.

Also export `captureClientError` as the same safe, deduplicating adapter with a
client-specific default source, and export `isTechnicalClientError(error)`.
That predicate returns `false` for `isExpectedDomainError(error)`, `true` for
network `TypeError`s and errors with numeric HTTP status 500 or higher, and
`false` for ordinary user-facing action messages. This keeps QueryClient from
turning validation or session-expiry toasts into Sentry issues.

4. Keep a module-level `WeakSet<object>` for successfully attempted object
   captures. Check it after unwrapping and before calling the SDK. Primitive
   failures are not deduplicated.
5. Convert non-`Error` objects to a bounded tag/message pair. Do not serialize
   arbitrary caller input or call `scope.setContext` with caller-provided
   objects.
6. Preserve the existing `userId` special handling and set all other context
   values as tags only after skipping `undefined`. Accept only scalar string,
   number, boolean, and short enum-like values; drop objects, arrays, and values
   whose key is a private/financial field.
7. Wrap the complete SDK interaction in `try/catch` and keep the catch silent.
8. Redact PostgreSQL URLs, credential assignments, email addresses,
   phone-like values, and financial-key values before sending Error messages or
   warning strings. Extend the `beforeSend` scrubbers in
   `instrumentation-client.ts`, `sentry.server.config.ts`, and
   `sentry.edge.config.ts` to scrub `event.message` and
   `event.exception.values[*].value` as well as existing request/context data.
9. Leave `captureServerWarning` safe and add the same context handling.

- [ ] **Step 4: Run the focused test and refactor without changing behavior**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/sentry.test.ts
```

Expected: all central reporter tests pass. Refactor only duplicated scope
setup or unwrapping code, then rerun the same command.

## Task 2: Make `withAction` the complete server-action boundary

**Files:**
- Modify: `src/lib/with-action.ts`
- Modify: `src/lib/__tests__/with-action.test.ts`

- [ ] **Step 1: Add failing Effect-boundary tests**

Add tests that mock `@/lib/sentry` and prove:

```typescript
it("captures DatabaseError even when an error message is configured", async () => {
  const failure = new DatabaseError({ cause: new Error("database down") })
  mockGetErrorTag.mockReturnValue("DatabaseError")

  const action = withAction({
    effect: () => Effect.fail(failure),
    errors: { DatabaseError: "Database error" },
  })

  await expect(action()).resolves.toEqual({ error: "Database error" })
  expect(mockCaptureServerError).toHaveBeenCalledWith(
    failure,
    expect.objectContaining({ source: "withAction:effect" }),
  )
})

it("does not capture a declared expected domain failure", async () => {
  const failure = new ValidationError({ message: "invalid" })
  mockGetErrorTag.mockReturnValue("ValidationError")

  const action = withAction({
    effect: () => Effect.fail(failure),
    errors: { ValidationError: "Invalid input" },
  })

  await expect(action()).resolves.toEqual({ error: "Invalid input" })
  expect(mockCaptureServerError).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the boundary tests and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/with-action.test.ts
```

Expected: the new `DatabaseError` test fails because the current code treats
every configured error mapping as expected.

- [ ] **Step 3: Implement classification at the Effect catch**

In the `withAction` Effect catch, replace the current condition:

```typescript
if (tag && opts.errors && tag in opts.errors) {
  return { error: opts.errors[tag] }
}
```

with this behavior:

```typescript
const mappedMessage =
  tag && opts.errors && tag in opts.errors ? opts.errors[tag] : undefined

if (mappedMessage && isExpectedDomainError(error)) {
  return { error: mappedMessage }
}

captureServerError(error, {
  source: "withAction:effect",
  permission: opts.permission,
  userId: session.user.id,
  role: (session.user as Record<string, unknown>).role,
  errorTag: tag,
})
console.error("[withAction]", error)
return { error: mappedMessage ?? "Internal server error" }
```

Import `isExpectedDomainError` from `@/lib/sentry`. Keep classic thrown-error
capture/rethrow behavior. Make the authentication/permission/IP gate capture
technical failures from `getSession`, `checkPermission`, or the IP gate with
sources `withAction:session`, `withAction:permission`, and
`withAction:ip-allowlist`, while preserving normal unauthorized/forbidden
responses. Add tests for each gate failure.

Delete the existing classic-mode heuristic that creates a new synthetic
`Error("Action returned 'Internal server error'...")`; audited inner catches
must report their original errors, and a synthetic replacement cannot be
deduplicated with the original object.

- [ ] **Step 4: Run the boundary and existing action utility tests**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/with-action.test.ts src/lib/__tests__/action-utils.test.ts
```

Expected: all tests pass, including the pre-existing generic failure mapping
tests.

## Task 3: Audit all server-action catch sites

**Files:**
- Modify: `src/actions/bank-account.actions.ts`
- Modify: `src/actions/creditor.actions.ts`
- Modify: `src/actions/customer.actions.ts`
- Modify: `src/actions/daily-collections.actions.ts`
- Modify: `src/actions/delegation.actions.ts`
- Modify: `src/actions/expense.actions.ts`
- Modify: `src/actions/fund-transfer.actions.ts`
- Modify: `src/actions/income.actions.ts`
- Modify: `src/actions/invitation.actions.ts`
- Modify: `src/actions/loan-waiver.actions.ts`
- Modify: `src/actions/loan.actions.ts`
- Modify: `src/actions/payment.actions.ts`
- Modify: `src/actions/rate-change-request.actions.ts`
- Modify: `src/actions/settings.actions.ts`
- Modify: `src/actions/settlement.actions.ts`
- Modify: `src/actions/user.actions.ts`
- Modify: `src/actions/__tests__/payment.actions.test.ts`
- Modify: `src/actions/__tests__/authorization.test.ts`

- [ ] **Step 1: Establish the audit baseline**

Run:

```bash
rg -n -C 3 "catch|Internal server error|console\.(error|warn)" src/actions -g '*.ts'
```

For every catch in the listed production files, classify it as either:

- expected domain translation: preserve without capture;
- technical failure returned to the caller: capture before return;
- best-effort cleanup/notification: use `captureServerWarning` or
  `captureServerError` before continuing.

No production `catch {` may remain where the caught value is needed for a
technical report.

- [ ] **Step 2: Add failing representative action assertions**

Extend the existing payment tests so `editPaymentAction` and
`getPaymentsByLoanAction` assert that an unexpected `Error` is captured with a
stable source and safe identifier context before the existing generic response
is returned. Add an authorization test proving the IP/session fallback still
returns its existing response while a technical cleanup error is captured as a
warning. Add a boundary test proving an inner capture plus the outer
`withAction` path produces one SDK event, not a synthetic duplicate.

- [ ] **Step 3: Update each technical catch with stable context**

Use this exact shape, substituting only the action-specific source and IDs:

```typescript
} catch (error) {
  const tag = getErrorTag(error)
  if (tag === "LoanNotFound") return { error: "Loan not found" }
  if (tag === "ValidationError") return { error: "Invalid request" }

  captureServerError(error, {
    source: "editPaymentAction",
    userId: session.user.id,
    paymentId: input.paymentId,
  })
  return { error: "Internal server error" }
}
```

For catches that intentionally return a more specific fallback, keep that
message but still capture. For `user.actions.ts`, which is not wrapped by
`withAction`, add the same capture behavior directly around the technical
`auth.api` operation. Never include full inputs, amounts, names, emails, or
database rows in context. Keep the existing payment diagnostic behavior and
route it through the central deduplicating reporter.

- [ ] **Step 4: Verify the action suite**

Run:

```bash
pnpm exec vitest run src/actions/__tests__ src/lib/__tests__/with-action.test.ts
```

Expected: all action tests pass and the new representative capture assertions
pass.

- [ ] **Step 5: Prove no bare technical catches remain**

Run:

```bash
rg -n "catch \{" src/actions -g '*.ts' -g '!**/__tests__/**'
```

Expected: no output, or only catches whose body is a deliberately documented
non-error control-flow probe. Any remaining result must be reviewed manually
before proceeding.

## Task 4: Report non-action server and operational failures

**Files:**
- Modify: `src/app/api/cron/cleanup/route.ts`
- Modify: `src/app/api/cron/month-end/route.ts`
- Modify: `src/app/api/cron/overdue/route.ts`
- Modify: `src/app/api/reports/balance-sheet/route.ts`
- Modify: `src/app/api/reports/pnl/route.ts`
- Modify: `src/app/api/reports/portfolio/route.ts`
- Modify: `src/app/api/reports/transactions/route.ts`
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/email.ts`
- Modify: `src/lib/ip-allowlist.ts`
- Modify: `src/lib/interest/loanBalanceData.ts`
- Modify: `src/collections/loans.ts`
- Modify: `src/lib/bounded-map.ts`

- [ ] **Step 1: Add failing tests for shared operational helpers**

Extend the existing IP allowlist tests and add focused tests for the email and
bounded-map fallback paths. Assert that the existing fail-open/fail-closed or
fire-and-forget result is unchanged and that the matching warning/error capture
is invoked with a source label. Use SDK mocks; do not send real Sentry events.

- [ ] **Step 2: Verify the new tests fail for missing capture calls**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/ip-allowlist.test.ts
```

Expected: the new capture assertions fail while the existing behavior tests
continue to pass.

- [ ] **Step 3: Add captures without changing fallback policy**

Replace patterns like:

```typescript
} catch (err) {
  console.warn("[ip-allowlist] ip lookup failed; failing closed", err)
  return false
}
```

with:

```typescript
} catch (error) {
  captureServerWarning("IP lookup failed; failing closed", {
    source: "ip-allowlist:isIpAllowed",
  })
  console.warn("[ip-allowlist] ip lookup failed; failing closed", error)
  return false
}
```

Use `captureServerError` for a failed report-generation/cron operation and
`captureServerWarning` for a deliberately continued cleanup, notification,
cache, or audit operation. In per-item cron loops include only a stable job
source and entity type, not raw row data. Preserve each existing HTTP status,
response body, and fail-open/fail-closed decision.

- [ ] **Step 4: Verify server route and helper tests**

Run:

```bash
pnpm exec vitest run src/lib/__tests__ src/actions/__tests__
```

Expected: all focused unit tests pass.

- [ ] **Step 5: Audit every production catch outside services**

Run:

```bash
rg -n -C 3 "catch|console\.(error|warn)" src/app/api src/lib src/collections -g '*.ts' -g '*.tsx' -g '!**/__tests__/**'
```

Every caught technical error must either call the central reporter or be
covered by Next’s uncaught `onRequestError` path because it is rethrown. Any
intentional suppression must have a warning capture and a stable source.

## Task 5: Cover client transport and render failures without duplicate events

**Files:**
- Modify: `src/lib/query-client.ts`
- Modify: `instrumentation-client.ts` only if tests expose a missing SDK setup guard
- Modify: `src/app/(app)/error.tsx` only if needed to add a stable error-boundary tag
- Modify: `src/app/global-error.tsx` only if needed to add a stable error-boundary tag
- Create or modify: focused client test under `src/lib/__tests__` if the existing test environment supports the QueryClient callbacks

- [ ] **Step 1: Add failing QueryClient callback tests**

Mock `captureClientError` (or the shared safe reporter exposed for browser
use), create the QueryClient, invoke the configured query and mutation error
callbacks, and assert that network/technical errors are captured with only
query-key/mutation-key labels. Also assert that a known user-facing action
error such as `Unauthorized` is not captured.

- [ ] **Step 2: Implement safe global QueryClient reporting**

Configure `QueryCache` and `MutationCache` callbacks in
`src/lib/query-client.ts`. Call `isTechnicalClientError` first, then call
`captureClientError(error, { source: "query", queryKey: String(query.queryKey[0]) })`
or the equivalent mutation source. `isTechnicalClientError` must use
documented shapes: `TypeError` is a transport failure; an object with a
numeric `status >= 500` is a server failure; an error tagged
`InternalServerError` is a technical failure; known expected domain tags and
user-facing validation/auth messages are excluded. Generic unexpected
`Error` instances remain reportable. Report only the technical cases.
Keep retry policy unchanged. Never pass query data or mutation variables to
Sentry.

Do not add manual `window` error or rejection listeners if the Sentry SDK’s
default integrations already provide them; doing so would create duplicate
events. Keep `instrumentation-client.ts`’s early initialization and scrubber.
The existing error boundaries may continue to capture render failures, with a
stable `source` tag if the SDK-mocked tests need boundary attribution.

- [ ] **Step 3: Verify client error behavior**

Run:

```bash
pnpm exec vitest run src/lib/__tests__
```

Expected: client reporter tests and all existing utility tests pass. Run the
existing Cypress suite if the app test harness is available; do not add a
production failure route solely to test Sentry.

## Task 6: Adversarial plan review and plan correction

**Files:**
- Review: `docs/superpowers/specs/2026-08-07-system-error-reporting-design.md`
- Review: `docs/superpowers/plans/2026-08-07-system-error-reporting.md`
- Modify: either document if review finds a gap

- [ ] **Step 1: Review the plan against the design**

Check every design requirement against a named task, file, test, and command.
Pay special attention to technical `DatabaseError` capture, duplicate-event
avoidance, privacy, error-classification false positives, and the fact that
Next’s SDK hooks are fallbacks rather than proof that caught errors are
reported.

- [ ] **Step 2: Run static plan audits**

Search the plan for unresolved unfinished-marker text. Expected: no output. Verify every referenced
function/type exists or is introduced in an earlier task.

- [ ] **Step 3: Resolve findings before implementation**

If review identifies a gap, edit the plan and rerun the static audits. Do not
start production edits until every finding is either fixed in the plan or
explicitly disproven by current source evidence.

### Recorded adversarial amendments

- Technical `DatabaseError` failures remain reportable even when
  `withAction` has a friendly configured mapping; the mapped response is
  preserved for the caller.
- The classic-mode synthetic “swallowed error” event is removed. Inner catches
  must report their original error so deduplication can operate on the actual
  object and retain its stack.
- Typed failures are reported by tag only. Raw typed-error fields and nested
  objects are never attached as Sentry context.
- Client classification is explicit: expected domain tags and known
  validation/auth messages are excluded, while generic unexpected `Error`
  instances, transport `TypeError`s, 5xx statuses, and internal-server tags
  remain reportable.
- Session, permission, and IP-allowlist gate failures have dedicated capture
  sources and tests so authentication infrastructure failures cannot become
  silent fallback responses.
- Implementation review additionally required case-insensitive financial-key
  scrubbing, labeled financial-value redaction in exception text, and a short
  warning deduplication window for repeated per-row integrity warnings.

## Task 7: Full implementation adversarial review loop

**Files:**
- Review all changed files and tests after Tasks 1–5.

- [ ] **Step 1: Run the complete verification suite**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

Record exact failures; do not claim completion from partial output.

- [ ] **Step 2: Perform a hostile source audit**

Run:

```bash
rg -n "catch \{|catch \(" src/actions src/app/api src/lib src/collections -g '*.ts' -g '*.tsx' -g '!**/__tests__/**'
rg -n "console\.(error|warn)|captureServer(Error|Warning)" src/actions src/app/api src/lib src/collections -g '*.ts' -g '*.tsx'
rg -n "amount|principal|investment|email|phone|address|customerName|creditorName|request\.body|request\.data" src/lib/sentry.ts instrumentation*.ts sentry.*.config.ts
```

For each catch, prove one of: expected domain translation, central capture
before fallback, warning capture before deliberate continuation, or rethrow to
Next’s `onRequestError`. For each Sentry context, prove no private row/input
data is passed. Check that warnings are not accidentally captured as errors and
that expected user errors are not sent as issues.

- [ ] **Step 3: Dispatch an adversarial code review**

Provide the reviewer with the base and current commit/tree state, the design,
the plan, and the actual verification output. Ask for concrete findings only,
prioritized Critical/Important/Minor, with file and line references. Treat all
Critical and Important findings as blockers.

- [ ] **Step 4: Fix every actionable finding and rerun the affected tests**

For each finding, add a regression test before changing production code when
the issue is behavioral. Rerun the narrow test, then the full suite. Repeat
the review/audit cycle until the reviewer reports no Critical or Important
findings and the static audits have no unexplained results.

## Task 8: Final requirement audit

- [ ] **Step 1: Compare the implementation to the approved design line by line**

Confirm central capture, technical/domain classification, caught-action
coverage, non-action coverage, client coverage, privacy, deduplication, and
verification are all evidenced by code and tests.

- [ ] **Step 2: Verify the final tree and report limitations honestly**

Run:

```bash
git diff --check
git status --short
```

Report any pre-existing unrelated changes and the Git metadata restriction
that prevented staging/committing, if it remains. Only claim completion after
fresh verification output proves the full requested scope.
