/**
 * Postgres unique constraint violation detector.
 * Used to handle UUID collisions when a client-supplied ID
 * conflicts with an existing row.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  // Postgres error code 23505 = unique_violation
  return (
    error instanceof Error &&
    "code" in error &&
    (error as any).code === "23505"
  )
}
