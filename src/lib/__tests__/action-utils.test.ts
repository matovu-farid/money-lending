import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------- Mocks ----------

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

// ---------- Imports ----------

import { auth } from "@/lib/auth"
import { getSession, getUserRole, requireRole, getErrorTag, getErrorField } from "../action-utils"

const mockAuthGetSession = vi.mocked(auth.api.getSession)

// The real session type comes from better-auth; we narrow to the bits
// these tests exercise without resorting to `any` casts.
type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>

// ---------- Tests ----------

describe("getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns session when user is present", async () => {
    const session = { user: { id: "u1", name: "Test", role: "admin" } }
    mockAuthGetSession.mockResolvedValue(session as unknown as AuthSession)

    const result = await getSession()

    expect(result).toEqual(session)
  })

  it("returns null when session is null", async () => {
    mockAuthGetSession.mockResolvedValue(null)

    const result = await getSession()

    expect(result).toBeNull()
  })

  it("returns null when session has no user", async () => {
    mockAuthGetSession.mockResolvedValue({ user: null } as unknown as AuthSession)

    const result = await getSession()

    expect(result).toBeNull()
  })

  it("returns null when session.user is undefined", async () => {
    mockAuthGetSession.mockResolvedValue({} as unknown as AuthSession)

    const result = await getSession()

    expect(result).toBeNull()
  })
})

describe("getUserRole", () => {
  it("returns the user role from session", () => {
    const session = { user: { role: "admin" } }
    expect(getUserRole(session)).toBe("admin")
  })

  it("defaults to 'unassigned' when role is null", () => {
    const session = { user: { role: null } }
    expect(getUserRole(session)).toBe("unassigned")
  })

  it("defaults to 'unassigned' when role is undefined", () => {
    const session: { user: { role?: string | null } } = { user: {} }
    expect(getUserRole(session)).toBe("unassigned")
  })
})

describe("requireRole", () => {
  it("returns null when user meets minimum role", () => {
    const session = { user: { role: "admin" } }
    expect(requireRole(session, "loanOfficer")).toBeNull()
  })

  it("returns null when user exactly matches minimum role", () => {
    const session = { user: { role: "supervisor" } }
    expect(requireRole(session, "supervisor")).toBeNull()
  })

  it("returns 'Forbidden' when user is below minimum role", () => {
    const session = { user: { role: "loanOfficer" } }
    expect(requireRole(session, "admin")).toBe("Forbidden")
  })

  it("returns custom message when user is below minimum role", () => {
    const session = { user: { role: "unassigned" } }
    expect(requireRole(session, "loanOfficer", "Not allowed")).toBe("Not allowed")
  })

  it("unassigned user fails any non-unassigned role check", () => {
    const session = { user: { role: "unassigned" } }
    expect(requireRole(session, "loanOfficer")).toBe("Forbidden")
  })

  it("superAdmin passes all role checks", () => {
    const session = { user: { role: "superAdmin" } }
    expect(requireRole(session, "superAdmin")).toBeNull()
    expect(requireRole(session, "admin")).toBeNull()
    expect(requireRole(session, "loanOfficer")).toBeNull()
  })

  it("handles null role as unassigned", () => {
    const session = { user: { role: null } }
    expect(requireRole(session, "loanOfficer")).toBe("Forbidden")
  })
})

describe("getErrorTag", () => {
  it("returns undefined for null/undefined", () => {
    expect(getErrorTag(null)).toBeUndefined()
    expect(getErrorTag(undefined)).toBeUndefined()
  })

  it("returns undefined for non-object", () => {
    expect(getErrorTag("string")).toBeUndefined()
    expect(getErrorTag(42)).toBeUndefined()
  })

  it("extracts _tag from direct error object", () => {
    const error = { _tag: "NotFound" }
    expect(getErrorTag(error)).toBe("NotFound")
  })

  it("extracts _tag from Effect FiberFailure wrapper (cause.failure)", () => {
    const error = {
      [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
        failure: { _tag: "ValidationError" },
      },
    }
    expect(getErrorTag(error)).toBe("ValidationError")
  })

  it("extracts _tag from Effect FiberFailure wrapper (cause.error)", () => {
    const error = {
      [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
        error: { _tag: "DatabaseError" },
      },
    }
    expect(getErrorTag(error)).toBe("DatabaseError")
  })

  it("extracts _tag via plain cause property", () => {
    const error = {
      cause: {
        failure: { _tag: "Timeout" },
      },
    }
    expect(getErrorTag(error)).toBe("Timeout")
  })

  it("returns undefined when no _tag is found in wrapper", () => {
    const error = {
      [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
        failure: { message: "no tag here" },
      },
    }
    expect(getErrorTag(error)).toBeUndefined()
  })

  it("returns undefined for object without _tag", () => {
    const error = { message: "just an error" }
    expect(getErrorTag(error)).toBeUndefined()
  })
})

describe("getErrorField", () => {
  it("returns undefined for null/undefined", () => {
    expect(getErrorField(null, "id")).toBeUndefined()
    expect(getErrorField(undefined, "id")).toBeUndefined()
  })

  it("returns undefined for non-object", () => {
    expect(getErrorField("string", "id")).toBeUndefined()
  })

  it("extracts field from direct error with _tag", () => {
    const error = { _tag: "NotFound", id: "123" }
    expect(getErrorField(error, "id")).toBe("123")
  })

  it("extracts field from Effect FiberFailure wrapper (cause.failure)", () => {
    const error = {
      [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
        failure: { _tag: "NotFound", id: "456" },
      },
    }
    expect(getErrorField(error, "id")).toBe("456")
  })

  it("extracts field from Effect FiberFailure wrapper (cause.error)", () => {
    const error = {
      [Symbol.for("effect/Runtime/FiberFailure/Cause")]: {
        error: { _tag: "NotFound", missing: ["NIN"] },
      },
    }
    expect(getErrorField(error, "missing")).toEqual(["NIN"])
  })

  it("extracts field via plain cause property", () => {
    const error = {
      cause: {
        failure: { _tag: "NotFound", name: "loan" },
      },
    }
    expect(getErrorField(error, "name")).toBe("loan")
  })

  it("returns undefined when field does not exist", () => {
    const error = { _tag: "NotFound", id: "123" }
    expect(getErrorField(error, "name")).toBeUndefined()
  })
})
