import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { validateNIN, validateUgandanPhone, validateFullName, validateRequired, validatePositiveDecimal } from "../validators"

describe("validateNIN", () => {
  it("accepts valid citizen NIN (starts with C, 13 digits)", () => {
    expect(validateNIN("C1234567890123")).toBeNull()
  })
  it("accepts valid foreigner NIN (starts with A, 13 digits)", () => {
    expect(validateNIN("A1234567890123")).toBeNull()
  })
  it("accepts lowercase (auto-uppercased)", () => {
    expect(validateNIN("c1234567890123")).toBeNull()
  })
  it("rejects short NIN", () => {
    expect(validateNIN("C12345")).not.toBeNull()
  })
  it("rejects letters in trailing positions", () => {
    expect(validateNIN("CM97027102X4CU")).not.toBeNull()
  })
  it("rejects wrong leading letter", () => {
    expect(validateNIN("B1234567890123")).not.toBeNull()
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
  it("accepts valid number with trailing/leading whitespace", () => {
    expect(validatePositiveDecimal("100 ", "Amount")).toBeNull()
    expect(validatePositiveDecimal(" 100", "Amount")).toBeNull()
    expect(validatePositiveDecimal(" 100.50 ", "Amount")).toBeNull()
  })
})

describe("Property-Based: Validator Functions", () => {
  // ── Arbitraries ──────────────────────────────────────────

  // Valid NIN per Uganda spec: leading C (citizen) or A (foreigner) + 13 digits
  const arbValidNIN = fc.tuple(
    fc.constantFrom("C", "A"),
    fc.array(fc.constantFrom("0","1","2","3","4","5","6","7","8","9"), { minLength: 13, maxLength: 13 }).map((a) => a.join("")),
  ).map(([prefix, digits]) => `${prefix}${digits}`)

  // Valid phone: 07 + 8 digits
  const arbValidPhone07 = fc.array(
    fc.constantFrom("0","1","2","3","4","5","6","7","8","9"),
    { minLength: 8, maxLength: 8 }
  ).map((a) => `07${a.join("")}`)

  // Valid phone: +2567 + 8 digits
  const arbValidPhone256 = fc.array(
    fc.constantFrom("0","1","2","3","4","5","6","7","8","9"),
    { minLength: 8, maxLength: 8 }
  ).map((a) => `+2567${a.join("")}`)

  const arbValidPhone = fc.oneof(arbValidPhone07, arbValidPhone256)

  // Valid full name: 2-4 words, each 2-10 alpha chars
  const arbWord = fc.array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    { minLength: 2, maxLength: 10 }
  ).map(a => a.join(""))
  const arbValidFullName = fc.tuple(arbWord, arbWord).map(([a, b]) => `${a} ${b}`)

  // Valid positive decimal: integer or with 1-2 decimal places, > 0
  const arbValidDecimal = fc.oneof(
    fc.integer({ min: 1, max: 999999 }).map(String),
    fc.tuple(
      fc.integer({ min: 1, max: 999999 }),
      fc.integer({ min: 0, max: 99 }),
    ).map(([whole, frac]) => {
      const fracStr = frac < 10 ? `0${frac}` : String(frac)
      return frac === 0 ? String(whole) : `${whole}.${fracStr}`
    }),
  )

  // Random string that is unlikely to match NIN pattern
  const arbRandomString = fc.string({ minLength: 0, maxLength: 30 })

  // ── validateNIN ──────────────────────────────────────────

  describe("validateNIN", () => {
    it("accepts all valid NINs (null = valid)", () => {
      fc.assert(
        fc.property(arbValidNIN, (nin) => {
          return validateNIN(nin) === null
        }),
        { numRuns: 300 }
      )
    })

    it("accepts lowercase valid NINs (auto-uppercased)", () => {
      fc.assert(
        fc.property(arbValidNIN, (nin) => {
          return validateNIN(nin.toLowerCase()) === null
        }),
        { numRuns: 200 }
      )
    })

    it("never crashes on random strings", () => {
      fc.assert(
        fc.property(arbRandomString, (s) => {
          const result = validateNIN(s)
          return result === null || typeof result === "string"
        }),
        { numRuns: 500 }
      )
    })

    it("rejects null and undefined", () => {
      expect(validateNIN(null)).not.toBeNull()
      expect(validateNIN(undefined)).not.toBeNull()
    })

    it("rejects strings that don't start with C or A", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("B","D","E","X","Z","1","0"),
          fc.array(fc.constantFrom("0","1","2","3","4","5","6","7","8","9"), { minLength: 13, maxLength: 13 }).map((a) => a.join("")),
          (badStart, rest) => {
            return validateNIN(badStart + rest) !== null
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ── validateUgandanPhone ─────────────────────────────────

  describe("validateUgandanPhone", () => {
    it("accepts all valid phone numbers", () => {
      fc.assert(
        fc.property(arbValidPhone, (phone) => {
          return validateUgandanPhone(phone) === null
        }),
        { numRuns: 300 }
      )
    })

    it("accepts phone numbers with spaces", () => {
      fc.assert(
        fc.property(arbValidPhone07, (phone) => {
          // Insert a space in the middle
          const withSpace = phone.slice(0, 4) + " " + phone.slice(4)
          return validateUgandanPhone(withSpace) === null
        }),
        { numRuns: 200 }
      )
    })

    it("never crashes on random strings", () => {
      fc.assert(
        fc.property(arbRandomString, (s) => {
          const result = validateUgandanPhone(s)
          return result === null || typeof result === "string"
        }),
        { numRuns: 500 }
      )
    })

    it("rejects strings with wrong length", () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(..."0123456789".split("")), { minLength: 1, maxLength: 8 }).map(a => a.join("")),
          (shortNum) => {
            return validateUgandanPhone(shortNum) !== null
          }
        ),
        { numRuns: 200 }
      )
    })

    it("rejects strings starting with 08, 09, etc.", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("08","09","06","05","01","02","03","04"),
          fc.array(fc.constantFrom(..."0123456789".split("")), { minLength: 8, maxLength: 8 }).map(a => a.join("")),
          (prefix, digits) => {
            return validateUgandanPhone(prefix + digits) !== null
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ── validateFullName ─────────────────────────────────────

  describe("validateFullName", () => {
    it("accepts all valid full names (2+ words)", () => {
      fc.assert(
        fc.property(arbValidFullName, (name) => {
          return validateFullName(name) === null
        }),
        { numRuns: 300 }
      )
    })

    it("accepts names with 3+ words", () => {
      fc.assert(
        fc.property(arbWord, arbWord, arbWord, (a, b, c) => {
          return validateFullName(`${a} ${b} ${c}`) === null
        }),
        { numRuns: 200 }
      )
    })

    it("rejects single words", () => {
      fc.assert(
        fc.property(arbWord, (word) => {
          return validateFullName(word) !== null
        }),
        { numRuns: 200 }
      )
    })

    it("never crashes on random strings", () => {
      fc.assert(
        fc.property(arbRandomString, (s) => {
          const result = validateFullName(s)
          return result === null || typeof result === "string"
        }),
        { numRuns: 500 }
      )
    })

    it("handles excessive whitespace correctly", () => {
      fc.assert(
        fc.property(arbWord, arbWord, fc.integer({ min: 2, max: 10 }), (a, b, spaces) => {
          const name = a + " ".repeat(spaces) + b
          return validateFullName(name) === null
        }),
        { numRuns: 200 }
      )
    })
  })

  // ── validateRequired ─────────────────────────────────────

  describe("validateRequired", () => {
    it("accepts any non-blank string", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
          (value) => {
            return validateRequired(value, "Test") === null
          }
        ),
        { numRuns: 300 }
      )
    })

    it("rejects whitespace-only strings", () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(" ", "\t", "\n"), { minLength: 0, maxLength: 20 }).map(a => a.join("")),
          (blanks) => {
            return validateRequired(blanks, "Test") !== null
          }
        ),
        { numRuns: 200 }
      )
    })

    it("error message includes field name", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-zA-Z]+$/.test(s)),
          (fieldName) => {
            const result = validateRequired("", fieldName)
            return result !== null && result.includes(fieldName)
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // ── validatePositiveDecimal ──────────────────────────────

  describe("validatePositiveDecimal", () => {
    it("accepts all valid positive decimals", () => {
      fc.assert(
        fc.property(arbValidDecimal, (value) => {
          return validatePositiveDecimal(value, "Amount") === null
        }),
        { numRuns: 300 }
      )
    })

    it("rejects zero", () => {
      expect(validatePositiveDecimal("0", "Amount")).not.toBeNull()
      expect(validatePositiveDecimal("0.00", "Amount")).not.toBeNull()
    })

    it("rejects negative numbers", () => {
      fc.assert(
        fc.property(fc.integer({ min: -999999, max: -1 }).map(String), (neg) => {
          return validatePositiveDecimal(neg, "Amount") !== null
        }),
        { numRuns: 200 }
      )
    })

    it("rejects more than 2 decimal places", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 999 }),
          fc.integer({ min: 100, max: 999 }),
          (whole, frac) => {
            return validatePositiveDecimal(`${whole}.${frac}`, "Amount") !== null
          }
        ),
        { numRuns: 200 }
      )
    })

    it("never crashes on random strings", () => {
      fc.assert(
        fc.property(arbRandomString, (s) => {
          const result = validatePositiveDecimal(s, "Amount")
          return result === null || typeof result === "string"
        }),
        { numRuns: 500 }
      )
    })
  })
})
