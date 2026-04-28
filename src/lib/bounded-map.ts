/**
 * Bounded cache utility for parameterized collection Maps.
 *
 * When the map reaches `maxSize` and a new key is being added, the oldest
 * entry (first inserted) is evicted. If `onEvict` is supplied, it's called
 * synchronously with the evicted value — call sites use this to call
 * `collection.cleanup()` so the underlying TanStack DB sync is torn down
 * instead of silently leaking subscriptions.
 *
 * Re-setting an already-present key is a plain in-place update; no eviction
 * runs (size doesn't grow), and the key keeps its insertion-order slot so
 * recently-touched entries are not arbitrarily promoted to MRU. That's
 * deliberately FIFO, not LRU — sufficient for our usage and simpler.
 */
export function boundedSet<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxSize: number,
  // `unknown` is intentional: collection.cleanup() returns Promise<void>, but
  // call sites may pass plain `void`-returning callbacks too. Duck-typed
  // `.catch` below handles the Promise case without forcing every site to
  // use a specific return shape.
  onEvict?: (evictedValue: V) => unknown,
): void {
  if (!map.has(key) && map.size >= maxSize) {
    const firstKey = map.keys().next().value
    if (firstKey !== undefined) {
      const evicted = map.get(firstKey)
      map.delete(firstKey)
      if (evicted !== undefined && onEvict) {
        // TanStack DB collection.cleanup() returns Promise<void>. We don't
        // await (eviction must be sync so the new entry can be set right
        // away), but we MUST attach a .catch — otherwise a rejected cleanup
        // propagates as an unhandledrejection.
        const result = onEvict(evicted)
        if (
          result !== null &&
          typeof result === "object" &&
          "catch" in result &&
          typeof (result as { catch: unknown }).catch === "function"
        ) {
          ;(result as Promise<unknown>).catch(() => {})
        }
      }
    }
  }
  map.set(key, value)
}
