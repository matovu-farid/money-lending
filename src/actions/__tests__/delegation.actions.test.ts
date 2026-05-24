import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "@/lib/with-action"

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  getUserRole: vi.fn(),
  requireRole: vi.fn(),
  checkPermission: vi.fn().mockResolvedValue(null),
  getErrorTag: (error: unknown): string | undefined => {
    if (error == null || typeof error !== "object") return undefined
    if ("_tag" in error) {
      const tag = (error as { _tag: unknown })._tag
      if (typeof tag === "string") return tag
    }
    return undefined
  },
}))

// Minimal withAction stub that bypasses real auth/permission/IP-allowlist
// machinery and just invokes the inner classic action. Typed using the
// concrete shapes the action delegate expects.
type ClassicActionOpts<TInput, TResult> = {
  permission?: string
  forbiddenMessage?: string
  action: (session: Session, input: TInput) => Promise<TResult>
}
vi.mock("@/lib/with-action", () => ({
  withAction: <TInput, TResult>(opts: ClassicActionOpts<TInput, TResult>) => {
    return async (input?: TInput) => {
      const session = { user: { id: "test-user", role: "admin" } } as unknown as Session
      return opts.action(session, (input ?? ({} as TInput)))
    }
  },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/services/delegation.service", () => ({
  createDelegation: vi.fn(),
  revokeDelegation: vi.fn(),
  listDelegations: vi.fn(),
}))

import {
  createDelegationAction,
  revokeDelegationAction,
  listDelegationsAction,
} from "../delegation.actions"
import {
  createDelegation,
  revokeDelegation,
  listDelegations,
} from "@/services/delegation.service"

describe("createDelegationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns error when userId is empty", async () => {
    const result = await createDelegationAction({ id: "del-test", userId: "" })
    expect(result).toEqual({ error: "User ID is required" })
  })

  it("returns error when userId is whitespace", async () => {
    const result = await createDelegationAction({ id: "del-test", userId: "   " })
    expect(result).toEqual({ error: "User ID is required" })
  })

  it("succeeds and returns data", async () => {
    const mockData = { id: "del-1", userId: "user-1" }
    vi.mocked(createDelegation).mockResolvedValue(
      mockData as unknown as Awaited<ReturnType<typeof createDelegation>>,
    )

    const result = await createDelegationAction({ id: "del-1", userId: "user-1" })
    expect(result).toEqual({ data: mockData })
    expect(createDelegation).toHaveBeenCalledWith("del-1", "user-1", "test-user")
  })

  it("returns error when service throws", async () => {
    vi.mocked(createDelegation).mockRejectedValue(new Error("DB error"))

    const result = await createDelegationAction({ id: "del-1", userId: "user-1" })
    expect(result).toEqual({ error: "DB error" })
  })
})

describe("revokeDelegationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns error when delegationId is empty", async () => {
    const result = await revokeDelegationAction({ delegationId: "" })
    expect(result).toEqual({ error: "Delegation ID is required" })
  })

  it("succeeds and returns data", async () => {
    const mockData = { id: "del-1", revoked: true }
    vi.mocked(revokeDelegation).mockResolvedValue(
      mockData as unknown as Awaited<ReturnType<typeof revokeDelegation>>,
    )

    const result = await revokeDelegationAction({ delegationId: "del-1" })
    expect(result).toEqual({ data: mockData })
    expect(revokeDelegation).toHaveBeenCalledWith("del-1", "test-user")
  })

  it("returns error when service throws", async () => {
    vi.mocked(revokeDelegation).mockRejectedValue(new Error("Not found"))

    const result = await revokeDelegationAction({ delegationId: "del-1" })
    expect(result).toEqual({ error: "Not found" })
  })
})

describe("listDelegationsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns data on success", async () => {
    const mockData = [{ id: "del-1" }, { id: "del-2" }]
    vi.mocked(listDelegations).mockResolvedValue(
      mockData as unknown as Awaited<ReturnType<typeof listDelegations>>,
    )

    const result = await listDelegationsAction()
    expect(result).toEqual({ data: mockData })
  })

  it("returns error on failure", async () => {
    vi.mocked(listDelegations).mockRejectedValue(new Error("Connection lost"))

    const result = await listDelegationsAction()
    expect(result).toEqual({ error: "Failed to load delegations" })
  })
})
