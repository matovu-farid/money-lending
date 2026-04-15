/**
 * A simple bounded cache utility for parameterized collection Maps.
 * When the map reaches its max size, the oldest entry (first inserted) is evicted.
 */
export function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, maxSize: number): void {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value
    if (firstKey !== undefined) map.delete(firstKey)
  }
  map.set(key, value)
}
