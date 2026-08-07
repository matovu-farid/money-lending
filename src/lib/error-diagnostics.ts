const MAX_DIAGNOSTIC_LENGTH = 500
const FALLBACK_MESSAGE = "Unexpected payment failure"

const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /\b(?:DATABASE_URL|POSTGRES_URL|password|token|secret|api[_-]?key)\s*=\s*[^\s"'<>]+/gi

const EFFECT_CAUSE_SYMBOL = Symbol.for("effect/Runtime/FiberFailure/Cause")

function unwrapDiagnosticError(error: unknown, seen = new Set<object>()): unknown {
  if (error == null || typeof error !== "object") return error
  if (seen.has(error)) return error
  seen.add(error)

  const effectCause = (error as Record<string | symbol, unknown>)[EFFECT_CAUSE_SYMBOL]
  if (effectCause && typeof effectCause === "object") {
    const inner =
      (effectCause as { failure?: unknown }).failure ??
      (effectCause as { error?: unknown }).error
    if (inner && inner !== error) return unwrapDiagnosticError(inner, seen)
  }

  if ((error as { _tag?: unknown })._tag === "DatabaseError") {
    const cause = (error as { cause?: unknown }).cause
    if (cause && cause !== error) return unwrapDiagnosticError(cause, seen)
  }

  return error
}

export function getDiagnosticErrorCause(error: unknown): unknown {
  return unwrapDiagnosticError(error)
}

function getMessage(error: unknown): string {
  const diagnosticError = getDiagnosticErrorCause(error)

  if (diagnosticError instanceof Error) return diagnosticError.message
  if (typeof diagnosticError === "string") return diagnosticError
  if (
    typeof diagnosticError === "number" ||
    typeof diagnosticError === "bigint" ||
    typeof diagnosticError === "boolean"
  ) {
    return String(diagnosticError)
  }
  if (diagnosticError && typeof diagnosticError === "object" && "message" in diagnosticError) {
    const message = (diagnosticError as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return FALLBACK_MESSAGE
}

export function getDiagnosticErrorMessage(error: unknown): string {
  const sanitized = getMessage(error)
    .replace(POSTGRES_URL_PATTERN, "[redacted]")
    .replace(CREDENTIAL_ASSIGNMENT_PATTERN, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()

  if (!sanitized) return FALLBACK_MESSAGE
  if (sanitized.length <= MAX_DIAGNOSTIC_LENGTH) return sanitized
  return `${sanitized.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`
}
