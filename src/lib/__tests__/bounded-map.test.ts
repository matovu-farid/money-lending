import { describe, it, expect, beforeEach, vi } from "vitest"
const { captureClientError } = vi.hoisted(() => ({ captureClientError: vi.fn() }))

vi.mock("@/lib/sentry", () => ({ captureClientError }))

import { boundedSet, boundedTouch } from "../bounded-map"

describe("boundedSet / boundedTouch", () => {
  beforeEach(() => captureClientError.mockReset())

  it("evicts the oldest unpinned key when full", () => {
    const map = new Map<string, number>()
    const evicted: number[] = []
    boundedSet(map, "a", 1, 2, (v) => evicted.push(v))
    boundedSet(map, "b", 2, 2, (v) => evicted.push(v))
    boundedSet(map, "c", 3, 2, (v) => evicted.push(v))
    expect(map.has("a")).toBe(false)
    expect(map.get("b")).toBe(2)
    expect(map.get("c")).toBe(3)
    expect(evicted).toEqual([1])
  })

  it("skips pinned keys when choosing eviction victim", () => {
    const map = new Map<string, number>()
    const pinned = new Set(["a"])
    const evicted: number[] = []
    boundedSet(map, "a", 1, 2, (v) => evicted.push(v), pinned)
    boundedSet(map, "b", 2, 2, (v) => evicted.push(v), pinned)
    boundedSet(map, "c", 3, 2, (v) => evicted.push(v), pinned)
    expect(map.has("a")).toBe(true)
    expect(map.has("b")).toBe(false)
    expect(map.get("c")).toBe(3)
    expect(evicted).toEqual([2])
  })

  it("boundedTouch moves a key to newest so it is not evicted next", () => {
    const map = new Map<string, number>()
    boundedSet(map, "a", 1, 3)
    boundedSet(map, "b", 2, 3)
    boundedSet(map, "c", 3, 3)
    boundedTouch(map, "a")
    boundedSet(map, "d", 4, 3)
    expect(map.has("a")).toBe(true)
    expect(map.has("b")).toBe(false)
    expect(map.has("c")).toBe(true)
    expect(map.has("d")).toBe(true)
  })

  it("reports rejected asynchronous eviction cleanup", async () => {
    const map = new Map<string, number>()
    const error = new Error("cleanup failed")
    boundedSet(map, "a", 1, 1)
    boundedSet(map, "b", 2, 1, () => Promise.reject(error))

    await Promise.resolve()
    expect(captureClientError).toHaveBeenCalledWith(error, {
      source: "bounded-map.on-evict",
    })
  })
})
