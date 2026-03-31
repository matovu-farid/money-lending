export function unwrapAction<T>(
  result: { data: T } | { error: string },
): T {
  if ("error" in result) {
    throw new Error(result.error)
  }
  return result.data
}
