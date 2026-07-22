/**
 * Bounded cache utility for parameterized collection Maps.
 *
 * Eviction is LRU-ish: `boundedTouch` moves a key to the newest slot on access.
 * When the map is full, the oldest entry (first key) is evicted unless it is
 * listed in `pinnedKeys` (R25-3 — keep the currently viewed loan/customer alive).
 *
 * If `onEvict` is supplied, it's called synchronously with the evicted value —
 * call sites use this to call `collection.cleanup()`.
 */

export function boundedTouch<K, V>(map: Map<K, V>, key: K): void {
  if (!map.has(key)) return
  const value = map.get(key)!
  map.delete(key)
  map.set(key, value)
}

export function boundedSet<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxSize: number,
  onEvict?: (evictedValue: V) => unknown,
  pinnedKeys?: ReadonlySet<K>,
): void {
  if (!map.has(key) && map.size >= maxSize) {
    let evictKey: K | undefined
    for (const candidate of map.keys()) {
      if (pinnedKeys?.has(candidate)) continue
      evictKey = candidate
      break
    }
    // If everything is pinned, fall back to oldest anyway to avoid unbounded growth
    if (evictKey === undefined) {
      evictKey = map.keys().next().value
    }
    if (evictKey !== undefined) {
      const evicted = map.get(evictKey)
      map.delete(evictKey)
      if (evicted !== undefined && onEvict) {
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
