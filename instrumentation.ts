// Next.js instrumentation hook. Called once per runtime at process boot.
// Sentry's @sentry/nextjs requires this file to load the runtime-specific
// init module and to export `onRequestError` so the framework can forward
// errors thrown inside Server Components / route handlers / middleware.
//
// See: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
import * as Sentry from "@sentry/nextjs"

export async function register() {
  if (process.env.NODE_ENV !== "production") return

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

// Forward any error Next.js catches from Server Components, route handlers,
// middleware, or proxies to Sentry. This is THE hook that gives us
// near-complete server-side coverage without wrapping every handler manually.
export const onRequestError = Sentry.captureRequestError
