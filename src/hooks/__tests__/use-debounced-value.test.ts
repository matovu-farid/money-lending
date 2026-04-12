/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useDebouncedValue } from "../use-debounced-value"

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("hello", 300))
    expect(result.current).toBe("hello")
  })

  it("does not update before the delay", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 300 } },
    )

    rerender({ value: "b", delay: 300 })

    // Advance only partway
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current).toBe("a")
  })

  it("updates after the delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 300 } },
    )

    rerender({ value: "b", delay: 300 })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toBe("b")
  })

  it("resets the timer on rapid changes", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 300 } },
    )

    // Change value rapidly
    rerender({ value: "b", delay: 300 })
    act(() => {
      vi.advanceTimersByTime(200)
    })

    rerender({ value: "c", delay: 300 })
    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Only 200ms since last change -- still "a"
    expect(result.current).toBe("a")

    // Complete the remaining 100ms
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current).toBe("c")
  })

  it("respects different delay values", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "x", delay: 500 } },
    )

    rerender({ value: "y", delay: 500 })

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe("x")

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe("y")
  })

  it("works with empty strings", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "text", delay: 100 } },
    )

    rerender({ value: "", delay: 100 })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current).toBe("")
  })
})
