// This file configures the initialization of Sentry for the edge runtime —
// loaded by `instrumentation.ts` when `NEXT_RUNTIME === "edge"`. Today the
// project only uses the Node.js runtime, but middleware (if added later)
// and any route handlers marked `export const runtime = "edge"` would land
// here. Keeping this in place means a future edge route gets coverage for
// free.
import * as Sentry from "@sentry/nextjs"

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
const ENABLED = process.env.NODE_ENV === "production" && !!DSN

if (ENABLED) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  })
}
