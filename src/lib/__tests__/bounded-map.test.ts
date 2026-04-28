import { describe, it, expect, vi } from "vitest"
import { boundedSet } from "@/lib/bounded-map"

describe("boundedSet", () => {
  it("inserts up to capacity without eviction", () => {
    const map = new Map<string, number>()
    const onEvict = vi.fn()
    boundedSet(map, "a", 1, 3, onEvict)
    boundedSet(map, "b", 2, 3, onEvict)
    boundedSet(map, "c", 3, 3, onEvict)
    expect(map.size).toBe(3)
    expect([...map.keys()]).toEqual(["a", "b", "c"])
    expect(onEvict).not.toHaveBeenCalled()
  })

  it("evicts the oldest entry when over capacity", () => {
    const map = new Map<string, number>()
    boundedSet(map, "a", 1, 2)
    boundedSet(map, "b", 2, 2)
    boundedSet(map, "c", 3, 2)
    expect(map.size).toBe(2)
    expect([...map.keys()]).toEqual(["b", "c"])
    expect(map.get("a")).toBeUndefined()
  })

  it("calls onEvict with the evicted value (and only on eviction)", () => {
    const map = new Map<string, { id: string }>()
    const evicted: Array<{ id: string }> = []
    const onEvict = (v: { id: string }) => evicted.push(v)

    boundedSet(map, "a", { id: "a" }, 2, onEvict)
    boundedSet(map, "b", { id: "b" }, 2, onEvict)
    expect(evicted).toEqual([])

    boundedSet(map, "c", { id: "c" }, 2, onEvict)
    expect(evicted).toEqual([{ id: "a" }])

    boundedSet(map, "d", { id: "d" }, 2, onEvict)
    expect(evicted).toEqual([{ id: "a" }, { id: "b" }])
  })

  it("does NOT call onEvict when re-setting an existing key (no eviction)", () => {
    const map = new Map<string, number>()
    const onEvict = vi.fn()
    boundedSet(map, "a", 1, 2, onEvict)
    boundedSet(map, "b", 2, 2, onEvict)
    // Map is already at capacity — but "a" already exists, so this is just an
    // in-place update. No eviction should fire.
    boundedSet(map, "a", 99, 2, onEvict)
    expect(onEvict).not.toHaveBeenCalled()
    expect(map.get("a")).toBe(99)
    expect(map.size).toBe(2)
  })

  it("preserves FIFO order on in-place update (does NOT promote to MRU)", () => {
    // Documented invariant in bounded-map.ts: re-setting an existing key is
    // an in-place update; the key keeps its insertion-order slot. So if we
    // re-set the oldest entry and then add a new key, the OLD oldest entry
    // is still the one evicted — not the more recently re-set one.
    const map = new Map<string, number>()
    const evicted: number[] = []
    const onEvict = (v: number) => evicted.push(v)
    boundedSet(map, "a", 1, 2, onEvict)
    boundedSet(map, "b", 2, 2, onEvict)
    boundedSet(map, "a", 99, 2, onEvict) // re-set oldest; should NOT promote
    boundedSet(map, "c", 3, 2, onEvict)  // FIFO: evict "a", not "b"
    expect(evicted).toEqual([99])         // (the most-recent value of "a")
    expect([...map.keys()]).toEqual(["b", "c"])
  })

  it("swallows rejected promises returned from onEvict", async () => {
    // collection.cleanup() returns Promise<void>; if it rejects, boundedSet
    // must NOT let that escape as an unhandledrejection.
    const map = new Map<string, number>()
    const unhandled: unknown[] = []
    const handler = (e: PromiseRejectionEvent) => {
      unhandled.push(e.reason)
    }
    if (typeof window !== "undefined") {
      window.addEventListener("unhandledrejection", handler)
    }
    try {
      const onEvict = (_v: number) => Promise.reject(new Error("teardown failed"))
      boundedSet(map, "a", 1, 1, onEvict)
      boundedSet(map, "b", 2, 1, onEvict) // forces eviction → rejected promise
      // Yield to the microtask queue so rejection has a chance to surface.
      await new Promise((r) => setTimeout(r, 10))
      expect(unhandled).toEqual([])
    } finally {
      if (typeof window !== "undefined") {
        window.removeEventListener("unhandledrejection", handler)
      }
    }
  })

  it("works without an onEvict callback", () => {
    const map = new Map<string, number>()
    expect(() => {
      boundedSet(map, "a", 1, 1)
      boundedSet(map, "b", 2, 1) // forces eviction with no callback
    }).not.toThrow()
    expect(map.size).toBe(1)
    expect(map.get("b")).toBe(2)
  })

  it("treats capacity 0 as 'always evict before set'", () => {
    // Edge case: capacity 0 means no entries should be retained.
    // boundedSet should still place the latest set, evicting whatever was
    // there. The current implementation evicts when size >= maxSize, so
    // with capacity 0 the eviction branch fires only if there's already
    // an entry (size 0 >= 0 is true, but firstKey() returns undefined,
    // so the eviction is a no-op and we still set the new key).
    const map = new Map<string, number>()
    const onEvict = vi.fn()
    boundedSet(map, "a", 1, 0, onEvict)
    expect(map.size).toBe(1) // we set, no prior entry to evict
    expect(onEvict).not.toHaveBeenCalled()

    boundedSet(map, "b", 2, 0, onEvict)
    // Size was 1 before this call; 1 >= 0 → evict "a", then set "b".
    expect(map.size).toBe(1)
    expect(map.get("b")).toBe(2)
    expect(onEvict).toHaveBeenCalledTimes(1)
    expect(onEvict).toHaveBeenCalledWith(1)
  })
})
