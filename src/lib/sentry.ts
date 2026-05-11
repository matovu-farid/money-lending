/**
 * Internal Sentry wrapper.
 *
 * Centralises the rules for forwarding errors and messages to Sentry so the
 * rest of the codebase doesn't need to know about the SDK or about
 * production gating.
 *
 * Rules:
 *   - Only forward in production. In dev/test we just no-op so we don't
 *     spam our quota or leak local secrets.
 *   - Strip Effect-TS `FiberFailure` wrapping and forward the inner cause —
 *     otherwise every error in Sentry shows up as the same opaque
 *     "FiberFailure" with no stack trace.
 *   - Tag with a `source` so issues are easy to filter on.
 *   - Forbid logging any PII from the calling site. Callers should pass
 *     IDs, not full objects.
 */
import * as Sentry from "@sentry/nextjs"

const ENABLED =
  process.env.NODE_ENV === "production" &&
  !!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN)

/** Context attached to every report. Keep values small and PII-free. */
export type CaptureContext = Record<string, unknown>

/**
 * Unwrap an Effect FiberFailure to its inner cause, if applicable. Keeps
 * the original on failure so Sentry still gets *something* useful.
 */
function unwrapEffectError(error: unknown): unknown {
  if (error == null || typeof error !== "object") return error
  const cause =
    (error as Record<string | symbol, unknown>)[
      Symbol.for("effect/Runtime/FiberFailure/Cause")
    ] ?? (error as { cause?: unknown }).cause
  if (cause && typeof cause === "object") {
    const inner =
      (cause as { failure?: unknown }).failure ??
      (cause as { error?: unknown }).error
    if (inner) return inner
  }
  return error
}

/**
 * Forward a server-side error to Sentry with structured context, after
 * stripping Effect's FiberFailure wrapper.
 */
export function captureServerError(error: unknown, context?: CaptureContext): void {
  if (!ENABLED) return
  try {
    const unwrapped = unwrapEffectError(error)
    Sentry.withScope((scope) => {
      if (context) {
        for (const [k, v] of Object.entries(context)) {
          if (v === undefined) continue
          if (k === "userId") {
            scope.setUser({ id: String(v) })
          } else {
            scope.setTag(k, String(v))
          }
        }
      }
      // If the unwrapped value isn't an Error instance, send it as a message
      // with a JSON-serialised payload so we don't lose typed-error fields.
      if (unwrapped instanceof Error) {
        Sentry.captureException(unwrapped)
      } else if (typeof unwrapped === "object" && unwrapped !== null) {
        scope.setContext("error", unwrapped as Record<string, unknown>)
        Sentry.captureMessage(
          `Typed error: ${
            (unwrapped as { _tag?: string })._tag ?? "Unknown"
          }`,
          "error",
        )
      } else {
        Sentry.captureMessage(String(unwrapped), "error")
      }
    })
  } catch {
    // Never let the error reporter itself crash an action.
  }
}

/**
 * Forward a warning (e.g. unauthorised admin-only access attempt on the
 * Electric proxy) to Sentry at `warning` level.
 */
export function captureServerWarning(message: string, context?: CaptureContext): void {
  if (!ENABLED) return
  try {
    Sentry.withScope((scope) => {
      if (context) {
        for (const [k, v] of Object.entries(context)) {
          if (v === undefined) continue
          if (k === "userId") {
            scope.setUser({ id: String(v) })
          } else {
            scope.setTag(k, String(v))
          }
        }
      }
      Sentry.captureMessage(message, "warning")
    })
  } catch {
    // ignore
  }
}
