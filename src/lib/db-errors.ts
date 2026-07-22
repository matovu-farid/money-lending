/**
 * Postgres unique constraint violation detector.
 * Used to handle UUID collisions when a client-supplied ID
 * conflicts with an existing row.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  // Postgres error code 23505 = unique_violation
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as any).code === "23505"
  )
}

/**
 * Get the constraint name from a Postgres unique constraint violation.
 * Returns null if not a unique violation or constraint name unknown.
 */
export function getUniqueConstraintName(error: unknown): string | null {
  if (!isUniqueConstraintError(error)) return null
  const constraint = (error as any).constraint_name ?? (error as any).constraint
  return typeof constraint === "string" ? constraint : null
}

export function getUniqueConstraintNameDeep(
  error: unknown,
  seen = new Set<object>(),
): string | null {
  if (!error || typeof error !== "object") return null
  if (seen.has(error)) return null
  seen.add(error)

  const direct = getUniqueConstraintName(error)
  if (direct) return direct

  const candidates = [
    (error as any).cause,
    (error as any).error,
    (error as any).failure,
    (error as any)[Symbol.for("effect/Runtime/FiberFailure/Cause")],
  ]

  for (const candidate of candidates) {
    const nested = getUniqueConstraintNameDeep(candidate, seen)
    if (nested) return nested
  }

  return null
}
