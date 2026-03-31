import { describe, it, expect } from "vitest"
import { unwrapAction } from "../query-utils"

describe("unwrapAction", () => {
  it("returns data when result contains data", () => {
    const result = { data: { foo: "bar" } }
    expect(unwrapAction(result)).toEqual({ foo: "bar" })
  })

  it("throws when result contains error", () => {
    const result = { error: "Something went wrong" }
    expect(() => unwrapAction(result)).toThrow("Something went wrong")
  })
})
