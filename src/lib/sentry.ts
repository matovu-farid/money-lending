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
import { getDiagnosticErrorCause } from "@/lib/error-diagnostics"

const ENABLED =
  process.env.NODE_ENV === "production" &&
  !!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN)

/** Context attached to every report. Keep values small and PII-free. */
export type CaptureContext = Record<string, unknown>

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

const PRIVATE_CONTEXT_KEYS = new Set([
  "email",
  "phone",
  "phonenumber",
  "address",
  "homeaddress",
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "set-cookie",
  "amount",
  "principal",
  "principalamount",
  "investmentamount",
  "outstandingbalance",
  "customername",
  "creditorname",
  "contact",
  "nin",
  "nationalid",
  "national_id",
])

const capturedObjects = new WeakSet<object>()
const warningLastSentAt = new Map<string, number>()
const WARNING_DEDUPE_WINDOW_MS = 60_000

const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /\b(?:DATABASE_URL|POSTGRES_URL|password|token|secret|api[_-]?key)\s*=\s*[^\s"'<>]+/gi
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_PATTERN = /(?<!\w)\+?[0-9][0-9 .()\-]{6,}[0-9](?!\w)/g
const FINANCIAL_VALUE_PATTERN =
  /\b(?:amount|principal(?:amount)?|investment(?:amount)?|outstanding(?:balance)?|available|required)\s*[:=]?\s*(?:UGX\s*)?[0-9][0-9,._\s-]*/gi
const EXPECTED_CLIENT_MESSAGE_PATTERN = /^(?:unauthorized|forbidden|invalid\b|.*\brequired\b|.*\bnot found\b|.*already exists\b|.*not allowed\b|.*cannot\b|.*can't\b)/i

function redactText(value: string): string {
  return value
    .replace(POSTGRES_URL_PATTERN, "[redacted-url]")
    .replace(CREDENTIAL_ASSIGNMENT_PATTERN, "[redacted-credential]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_PATTERN, "[redacted-phone]")
    .replace(FINANCIAL_VALUE_PATTERN, "[redacted-financial]")
    .slice(0, 160)
}

function errorTag(error: unknown): string | undefined {
  const unwrapped = getDiagnosticErrorCause(error)
  if (unwrapped && typeof unwrapped === "object") {
    const tag = (unwrapped as { _tag?: unknown })._tag
    return typeof tag === "string" ? tag : undefined
  }
  return undefined
}

function setSafeScopeContext(scope: {
  setTag: (key: string, value: string) => void
  setUser: (user: { id: string }) => void
}, context?: CaptureContext): void {
  if (!context) return

  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || PRIVATE_CONTEXT_KEYS.has(key.toLowerCase())) continue
    if (key === "userId") {
      if (typeof value === "string" && value.length <= 160) {
        scope.setUser({ id: value })
      }
      continue
    }
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue
    }
    const safeValue = redactText(String(value))
    scope.setTag(key, safeValue)
  }
}

/** Return true when the failure is an expected user/business outcome. */
export function isExpectedDomainError(error: unknown): boolean {
  return EXPECTED_DOMAIN_ERROR_TAGS.has(errorTag(error) ?? "")
}

/** Return true only for client failures that indicate a technical outage. */
export function isTechnicalClientError(error: unknown): boolean {
  if (isExpectedDomainError(error)) return false
  if (error && typeof error === "object") {
    const tag = (error as { _tag?: unknown })._tag
    if (tag === "ExpectedActionError") return false
    if (tag === "InternalServerError") return true
    const status = (error as { status?: unknown }).status
    if (typeof status === "number" && status >= 500) return true
  }
  if (error instanceof TypeError) return true
  if (error instanceof Error) {
    if (EXPECTED_CLIENT_MESSAGE_PATTERN.test(error.message)) return false
    return true
  }
  return false
}

/**
 * Forward a server-side error to Sentry with structured context, after
 * stripping Effect's FiberFailure wrapper.
 */
export function captureServerError(error: unknown, context?: CaptureContext): void {
  if (!ENABLED) return
  try {
    const unwrapped = getDiagnosticErrorCause(error)
    if (unwrapped && typeof unwrapped === "object") {
      if (capturedObjects.has(unwrapped)) return
      capturedObjects.add(unwrapped)
    }
    Sentry.withScope((scope) => {
      setSafeScopeContext(scope, context)
      // If the unwrapped value isn't an Error instance, send it as a message
      // with its tag only. Raw typed-error fields may contain private data.
      if (unwrapped instanceof Error) {
        Sentry.captureException(unwrapped)
      } else if (typeof unwrapped === "object" && unwrapped !== null) {
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
    const safeMessage = redactText(message)
    const source = typeof context?.source === "string" ? context.source : ""
    const warningKey = `${source}:${safeMessage}`
    const now = Date.now()
    const lastSentAt = warningLastSentAt.get(warningKey)
    if (lastSentAt !== undefined && now - lastSentAt < WARNING_DEDUPE_WINDOW_MS) return
    warningLastSentAt.set(warningKey, now)
    Sentry.withScope((scope) => {
      setSafeScopeContext(scope, context)
      Sentry.captureMessage(safeMessage, "warning")
    })
  } catch {
    // ignore
  }
}

/** Capture a technical browser/query failure with the same privacy rules. */
export function captureClientError(error: unknown, context?: CaptureContext): void {
  if (!isTechnicalClientError(error)) return
  captureServerError(error, { source: "client", ...context })
}
