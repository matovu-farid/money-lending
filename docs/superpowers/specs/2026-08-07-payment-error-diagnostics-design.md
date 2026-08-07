# Payment Error Diagnostics Design

## Goal

When recording a payment fails unexpectedly, the existing payment toast should
show a useful, sanitized diagnostic message instead of only `Internal server
error`. Every unexpected payment error must also be sent to Sentry with enough
context to identify the failing action without including credentials or
customer-identifying data.

## Current problem

`recordPaymentAction` catches every unexpected exception and returns
`{ error: "Internal server error" }`. The classic `withAction` wrapper then
only sees that generic result, so it cannot capture the database exception or
its stack trace. This is why the Sentry issue currently visible for the loan
page does not identify the payment failure.

## Design

1. Add a small error-diagnostics helper for server-action diagnostics. It will
   unwrap the Effect and `DatabaseError` layers to reach the underlying cause,
   preserve the useful exception message, remove connection strings and
   credential-like values, collapse excessive whitespace, and cap the output
   length. If no safe message is available, it will use a stable fallback.
2. In `recordPaymentAction`, preserve the existing user-facing messages for
   validation and missing-loan errors. For unexpected errors, capture the
   original error through `captureServerError` so it is sent to Sentry with the
   action name, loan ID, and authenticated user ID, then return the sanitized
   message to the toast.
3. Keep the existing fire-and-forget notification behavior unchanged. Email
   failures are already swallowed and are not the cause of the action result.
4. Add focused unit tests for the sanitizer and unexpected-payment error
   behavior, including redaction and fallback cases.

## Security and compatibility

- Do not return database URLs, passwords, tokens, SQL query text containing
  secrets, or full customer records to the browser.
- Do not change successful payment behavior or expected validation messages.
- Do not expose raw Sentry configuration values in the response.
- Sentry capture is best-effort and must never replace or mask the user-facing
  diagnostic response.
- The existing toast consumer already renders the returned `error` string, so
  no UI contract change is required.

## Verification

- Run the focused payment/action tests.
- Run the relevant unit test suite and type/lint checks available in the
  repository.
- Review the final diff to ensure unrelated working-tree files are untouched.
