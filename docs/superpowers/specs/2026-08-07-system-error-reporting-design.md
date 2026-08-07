# System Error Reporting Design

**Date:** 2026-08-07
**Status:** Approved for implementation

## Goal

Make unexpected technical failures and operational warnings visible in the
production Sentry project across the browser, Next.js server runtimes, server
actions, API/cron handlers, data synchronization, and best-effort background
helpers. Preserve existing user-facing behavior and keep expected business
outcomes out of Sentry issues.

## Scope and classification

Sentry receives:

- uncaught exceptions and rejected promises;
- technical failures caught and converted into a generic or fallback result;
- database, Effect runtime, transport, serialization, and integration failures;
- operational warnings when the system deliberately continues after a degraded
  operation, such as a failed audit/IP capture or a fail-open/fail-closed
  lookup.

Sentry does not receive normal validation, not-found, unauthorized, forbidden,
insufficient-funds, or other declared domain outcomes. A `DatabaseError` is
always technical and is captured even when an action maps it to a friendly
message such as `Database error`.

Runtime reporting remains production-gated and DSN-gated. Development and test
runs use mocked SDK calls and do not emit real events.

## Architecture

### Central reporter

`src/lib/sentry.ts` is the only application-level reporting adapter. It will:

1. unwrap Effect `FiberFailure` and `DatabaseError` layers while retaining the
   original `Error` stack whenever one exists;
2. capture exceptions with a stable `source` tag and bounded context;
3. capture operational warnings at warning level;
4. deduplicate an object that is reported by an inner catch and then reaches a
   shared boundary;
5. catch failures from the Sentry SDK itself so reporting cannot change the
   application result.

Callers pass identifiers and fixed labels only. They do not pass input objects,
database rows, request bodies, credentials, creditor/customer names, or
financial amounts.

The existing server, edge, and browser SDK initialization remains in place.
Its `beforeSend` scrubbers continue to remove request bodies, cookies,
credentials, identifiers, contact fields, and financial fields. The central
reporter and client error boundaries use the same safe-context rules.

### Server action boundary

`withAction` remains the final boundary for both Effect and classic actions.
For Effect actions it distinguishes expected domain tags from technical
failures. Mapping a technical tag to a user-facing message does not suppress
capture. For classic actions, thrown failures are captured and rethrown as
today so Next can preserve its normal server-action flow.

Inner action catches remain where they translate expected service errors or
preserve a useful response. Every technical branch that returns a generic
error reports the original exception first. Bare catches are removed or
changed to receive the error. This prevents the existing “original swallowed”
pattern from losing stack traces.

### Non-action and client paths

- Next `instrumentation.ts` keeps `onRequestError` as the fallback for uncaught
  Server Component, route, proxy, middleware, and action errors.
- API, cron, report, Electric, auth, email, IP-allowlist, and collection
  fallback paths use the central reporter with stable source labels.
- The client instrumentation explicitly protects early browser errors and
  unhandled rejections, while segment/global error boundaries continue to
  report render failures.
- Electric/query synchronization errors report table or operation labels only,
  never synchronized row payloads.

## Data flow

```text
technical failure
       |
       +--> uncaught Next/browser error --> Sentry SDK boundary
       |
       +--> caught in action/API/helper --> central reporter --> Sentry SDK
       |                                      |
       |                                      +--> unwrap + scrub + tag
       |
       +--> expected domain outcome -------> existing user-facing response
```

The reporter is best-effort and synchronous from the caller’s perspective;
the SDK manages transport delivery. No caller waits on Sentry or changes a
successful fallback into a failure because reporting is unavailable.

## Testing and verification

Vitest will cover:

- FiberFailure and DatabaseError unwrapping;
- technical-versus-domain classification;
- one-event deduplication;
- safe context and message scrubbing;
- reporter failures never throwing;
- representative Effect and classic action catches;
- operational warning capture.

Cypress will cover the application’s client error-boundary behavior and the
existing user-visible fallback contract. SDK calls are mocked in unit tests;
dashboard delivery is an environment concern and is not asserted against a
live Sentry project in CI.

Final verification runs typecheck, lint, the full Vitest suite, and Cypress.

## Non-goals

- Capturing expected validation/auth/not-found traffic as Sentry issues.
- Sending raw request, form, database, creditor, customer, or financial data.
- Changing action/API response shapes or retry/fail-open/fail-closed policy.
- Adding a new logging backend or replacing existing application logs.
