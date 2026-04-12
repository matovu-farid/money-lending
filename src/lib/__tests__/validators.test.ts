import { describe, it, expect } from "vitest"
import { validateNIN, validateUgandanPhone, validateFullName, validateRequired, validatePositiveDecimal } from "../validators"

describe("validateNIN", () => {
  it("accepts valid NIN", () => {
    expect(validateNIN("CM97027102X4CU")).toBeNull()
  })
  it("accepts lowercase (auto-uppercased)", () => {
    expect(validateNIN("cm97027102x4cu")).toBeNull()
  })
  it("rejects short NIN", () => {
    expect(validateNIN("CM9702")).not.toBeNull()
  })
  it("rejects empty", () => {
    expect(validateNIN("")).not.toBeNull()
    expect(validateNIN(undefined)).not.toBeNull()
  })
})

describe("validateUgandanPhone", () => {
  it("accepts 07XXXXXXXX", () => {
    expect(validateUgandanPhone("0771234567")).toBeNull()
  })
  it("accepts +2567XXXXXXXX", () => {
    expect(validateUgandanPhone("+256771234567")).toBeNull()
  })
  it("accepts with spaces", () => {
    expect(validateUgandanPhone("077 123 4567")).toBeNull()
  })
  it("rejects too short", () => {
    expect(validateUgandanPhone("07712")).not.toBeNull()
  })
})

describe("validateFullName", () => {
  it("requires at least two words", () => {
    expect(validateFullName("John")).not.toBeNull()
    expect(validateFullName("John Doe")).toBeNull()
  })
  it("rejects empty", () => {
    expect(validateFullName("")).not.toBeNull()
  })
})

describe("validateRequired", () => {
  it("rejects empty/blank", () => {
    expect(validateRequired("", "Field")).not.toBeNull()
    expect(validateRequired("  ", "Field")).not.toBeNull()
  })
  it("accepts non-empty", () => {
    expect(validateRequired("hello", "Field")).toBeNull()
  })
})

describe("validatePositiveDecimal", () => {
  it("accepts valid decimal", () => {
    expect(validatePositiveDecimal("100.50", "Amount")).toBeNull()
  })
  it("rejects zero", () => {
    expect(validatePositiveDecimal("0", "Amount")).not.toBeNull()
  })
  it("rejects non-numeric", () => {
    expect(validatePositiveDecimal("abc", "Amount")).not.toBeNull()
  })
})
