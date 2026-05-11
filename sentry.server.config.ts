// This file configures the initialization of Sentry on the Node.js server.
// It is loaded by `instrumentation.ts` via `register()` when
// `NEXT_RUNTIME === "nodejs"`. Server Actions, route handlers, cron jobs,
// and React Server Components all run here.
import * as Sentry from "@sentry/nextjs"

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
const ENABLED = process.env.NODE_ENV === "production" && !!DSN

if (ENABLED) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    // Modest sample rate for server perf traces.
    tracesSampleRate: 0.1,

    // No PII auto-attached. We scrub anything that slips through in
    // beforeSend below.
    sendDefaultPii: false,

    beforeSend(event) {
      return scrubEvent(event)
    },
  })
}

// ---------------------------------------------------------------------------
// PII scrubbing — kept inline so this file is self-contained when bundled.
// Keep in sync with instrumentation-client.ts.
// ---------------------------------------------------------------------------

const PII_KEYS = new Set([
  "nin",
  "national_id",
  "nationalId",
  "phone",
  "phoneNumber",
  "phone_number",
  "address",
  "homeAddress",
  "email",
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "set-cookie",
  "amount",
  "principal",
  "principalAmount",
  "investmentAmount",
  "outstandingBalance",
])

function scrubValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(scrubValue)
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? "[redacted]" : scrubValue(v)
    }
    return out
  }
  return value
}

function scrubEvent<T extends { request?: unknown; extra?: unknown; contexts?: unknown }>(
  event: T,
): T {
  if (event.request && typeof event.request === "object") {
    const req = event.request as Record<string, unknown>
    if ("data" in req) delete req.data
    if ("cookies" in req) delete req.cookies
    if ("headers" in req && typeof req.headers === "object") {
      req.headers = scrubValue(req.headers)
    }
  }
  if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra
  if (event.contexts) event.contexts = scrubValue(event.contexts) as typeof event.contexts
  return event
}
