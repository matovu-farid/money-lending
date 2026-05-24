import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect, Data } from "effect"

// ---------- Mocks ----------

const mockGetSession = vi.fn()
const mockCheckPermission = vi.fn()
const mockGetErrorTag = vi.fn()
const mockRevalidatePath = vi.fn()
const mockGetUserRole = vi.fn()

vi.mock("@/lib/action-utils", () => ({
  getSession: () => mockGetSession(),
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
  getUserRole: (...args: unknown[]) => mockGetUserRole(...args),
  getErrorTag: (error: unknown) => mockGetErrorTag(error),
}))

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => mockRevalidatePath(path),
}))

// Import after mocks
import { withAction } from "../with-action"

// ---------- Test helpers ----------

const fakeSession = {
  user: { id: "u1", name: "Test", role: "admin" },
  session: { id: "s1" },
}

class NotFoundError extends Data.TaggedError("NotFoundError")<{
  message: string
}> {}

// ---------- Tests ----------

describe("withAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(fakeSession)
    mockCheckPermission.mockResolvedValue(null) // no forbidden
    mockGetUserRole.mockReturnValue(fakeSession.user.role ?? "unassigned")
  })

  // ---------------------------------------------------------------
  // Classic mode
  // ---------------------------------------------------------------

  describe("classic mode", () => {
    it("calls the action with session and returns its result", async () => {
      const action = withAction({
        action: async () => ({ data: [1, 2, 3] }),
      })
      const result = await action()
      expect(result).toEqual({ data: [1, 2, 3] })
    })

    it("passes input to the action", async () => {
      const action = withAction<{ id: string }, { data: string }>({
        action: async (_session, input) => ({ data: input.id }),
      })
      const result = await action({ id: "abc" })
      expect(result).toEqual({ data: "abc" })
    })

    it("returns Unauthorized when session is null", async () => {
      mockGetSession.mockResolvedValue(null)
      const action = withAction({
        action: async () => ({ data: "ok" }),
      })
      const result = await action()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("returns forbidden when permission check fails", async () => {
      mockCheckPermission.mockResolvedValue("Forbidden")
      const action = withAction({
        permission: "loan:create",
        action: async () => ({ data: "ok" }),
      })
      const result = await action()
      expect(result).toEqual({ error: "Forbidden" })
    })

    it("passes forbiddenMessage through to checkPermission", async () => {
      mockCheckPermission.mockResolvedValue("Custom forbidden message")
      const action = withAction({
        permission: "loan:create",
        forbiddenMessage: "Custom forbidden message",
        action: async () => ({ data: "ok" }),
      })
      const result = await action()
      expect(mockCheckPermission).toHaveBeenCalledWith(
        fakeSession,
        "loan:create",
        "Custom forbidden message",
      )
      expect(result).toEqual({ error: "Custom forbidden message" })
    })

    it("does not call checkPermission when no permission is specified", async () => {
      const action = withAction({
        action: async () => ({ data: "ok" }),
      })
      await action()
      expect(mockCheckPermission).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------
  // Effect mode
  // ---------------------------------------------------------------

  describe("effect mode", () => {
    it("runs Effect and returns { data } on success", async () => {
      const action = withAction({
        effect: () => Effect.succeed({ items: [1, 2] }),
      })
      const result = await action()
      expect(result).toEqual({ data: { items: [1, 2] } })
    })

    it("passes input to the effect function", async () => {
      const action = withAction<{ name: string }, string>({
        effect: (_session, input) => Effect.succeed(input.name),
      })
      const result = await action({ name: "hello" })
      expect(result).toEqual({ data: "hello" })
    })

    it("maps tagged errors to user-facing messages via errors option", async () => {
      mockGetErrorTag.mockReturnValue("NotFoundError")

      const action = withAction({
        effect: () => Effect.fail(new NotFoundError({ message: "gone" })),
        errors: {
          NotFoundError: "The item was not found",
          ValidationError: "Invalid input",
        },
      })

      const result = await action()
      expect(result).toEqual({ error: "The item was not found" })
    })

    it("returns 'Internal server error' for unmapped error tags", async () => {
      mockGetErrorTag.mockReturnValue("SomeRandomError")

      const action = withAction({
        effect: () => Effect.fail(new NotFoundError({ message: "oops" })),
        errors: {
          ValidationError: "Invalid input",
        },
      })

      const result = await action()
      expect(result).toEqual({ error: "Internal server error" })
    })

    it("returns 'Internal server error' when getErrorTag returns undefined", async () => {
      mockGetErrorTag.mockReturnValue(undefined)

      const action = withAction({
        effect: () => Effect.fail("something unexpected"),
      })

      const result = await action()
      expect(result).toEqual({ error: "Internal server error" })
    })

    it("revalidates static paths on success", async () => {
      const action = withAction({
        effect: () => Effect.succeed("ok"),
        revalidate: ["/loans", "/dashboard"],
      })

      await action()
      expect(mockRevalidatePath).toHaveBeenCalledTimes(2)
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard")
    })

    it("supports dynamic revalidation paths via function", async () => {
      const action = withAction<{ loanId: string }, string>({
        effect: () => Effect.succeed("done"),
        revalidate: (input) => ["/loans", `/loans/${input.loanId}`],
      })

      await action({ loanId: "L1" })
      expect(mockRevalidatePath).toHaveBeenCalledTimes(2)
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans")
      expect(mockRevalidatePath).toHaveBeenCalledWith("/loans/L1")
    })

    it("does not revalidate on failure", async () => {
      mockGetErrorTag.mockReturnValue("NotFoundError")

      const action = withAction({
        effect: () => Effect.fail(new NotFoundError({ message: "nope" })),
        errors: { NotFoundError: "Not found" },
        revalidate: ["/loans"],
      })

      await action()
      expect(mockRevalidatePath).not.toHaveBeenCalled()
    })

    it("returns Unauthorized when session is null", async () => {
      mockGetSession.mockResolvedValue(null)

      const action = withAction({
        effect: () => Effect.succeed("data"),
      })

      const result = await action()
      expect(result).toEqual({ error: "Unauthorized" })
    })

    it("checks permission before running effect", async () => {
      mockCheckPermission.mockResolvedValue("Forbidden")

      const effectFn = vi.fn(() => Effect.succeed("data"))
      const action = withAction({
        permission: "loan:create",
        effect: effectFn,
      })

      const result = await action()
      expect(result).toEqual({ error: "Forbidden" })
      expect(effectFn).not.toHaveBeenCalled()
    })

    it("does not call checkPermission in effect mode when no permission specified", async () => {
      const action = withAction({
        effect: () => Effect.succeed("data"),
      })

      await action()
      expect(mockCheckPermission).not.toHaveBeenCalled()
    })
  })
})
