import { describe, it, expect } from "vitest"
import { unwrapAction } from "../query-utils"

describe("unwrapAction", () => {
  it("returns data when result contains data", () => {
    const result = { data: { foo: "bar" } }
    expect(unwrapAction(result)).toEqual({ foo: "bar" })
  })

  it("returns primitive data", () => {
    expect(unwrapAction({ data: 42 })).toBe(42)
    expect(unwrapAction({ data: "hello" })).toBe("hello")
    expect(unwrapAction({ data: true })).toBe(true)
  })

  it("returns null data without throwing", () => {
    expect(unwrapAction({ data: null })).toBeNull()
  })

  it("returns undefined data without throwing", () => {
    expect(unwrapAction({ data: undefined })).toBeUndefined()
  })

  it("returns array data", () => {
    const arr = [1, 2, 3]
    expect(unwrapAction({ data: arr })).toEqual([1, 2, 3])
  })

  it("returns empty object data", () => {
    expect(unwrapAction({ data: {} })).toEqual({})
  })

  it("throws when result contains error", () => {
    const result = { error: "Something went wrong" }
    expect(() => unwrapAction(result)).toThrow("Something went wrong")
  })

  it("throws an Error instance", () => {
    const result = { error: "boom" }
    expect(() => unwrapAction(result)).toThrow(Error)
  })

  it("throws with the exact error message", () => {
    expect(() => unwrapAction({ error: "DB connection failed" })).toThrow(
      "DB connection failed",
    )
  })

  it("throws with empty string error message", () => {
    // "error" key is present, so it should throw even if message is empty
    expect(() => unwrapAction({ error: "" })).toThrow("")
  })
})
