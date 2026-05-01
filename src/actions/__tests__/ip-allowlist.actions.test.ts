import { describe, it, expect, beforeEach, vi, type Mock } from "vitest"

vi.mock("@/lib/action-utils", () => ({
  getSession: vi.fn(),
  checkPermission: vi.fn(),
}))
vi.mock("@/lib/ip-allowlist", () => ({
  clearCaches: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

// Minimal DB mock — actions call select/insert/delete with chainable builders
vi.mock("@/lib/db", () => {
  const returning = vi.fn().mockResolvedValue([{ ip: "1.2.3.4", userId: "u1" }])
  const onConflictDoUpdate = vi.fn().mockResolvedValue([])
  const limit = vi.fn().mockResolvedValue([{ value: "false" }])
  const from = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit }) })
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate, returning })
  return {
    db: {
      select: vi.fn().mockReturnValue({ from }),
      insert: vi.fn().mockReturnValue({ values }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) }),
    },
  }
})

import { getSession, checkPermission } from "@/lib/action-utils"
import { clearCaches } from "@/lib/ip-allowlist"
import {
  setIpAllowlistEnabledAction,
  removeAllowlistEntryAction,
  clearAllowlistAction,
} from "@/actions/ip-allowlist.actions"

const adminSession = { user: { id: "admin-1", role: "admin" } }

describe("ip-allowlist actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getSession as unknown as Mock).mockResolvedValue(adminSession)
    ;(checkPermission as unknown as Mock).mockResolvedValue(null)
  })

  it("setIpAllowlistEnabledAction returns Forbidden for non-admin", async () => {
    ;(checkPermission as unknown as Mock).mockResolvedValue("Forbidden")
    const result = await setIpAllowlistEnabledAction({ enabled: true })
    expect(result).toEqual({ error: "Forbidden" })
  })

  it("setIpAllowlistEnabledAction clears caches on success", async () => {
    const result = await setIpAllowlistEnabledAction({ enabled: true })
    expect("data" in result).toBe(true)
    expect(clearCaches).toHaveBeenCalled()
  })

  it("removeAllowlistEntryAction returns Forbidden for non-admin", async () => {
    ;(checkPermission as unknown as Mock).mockResolvedValue("Forbidden")
    const result = await removeAllowlistEntryAction({ entryId: "abc" })
    expect(result).toEqual({ error: "Forbidden" })
  })

  it("clearAllowlistAction returns Forbidden for non-admin", async () => {
    ;(checkPermission as unknown as Mock).mockResolvedValue("Forbidden")
    const result = await clearAllowlistAction()
    expect(result).toEqual({ error: "Forbidden" })
  })

  it("removeAllowlistEntryAction clears caches on success", async () => {
    await removeAllowlistEntryAction({ entryId: crypto.randomUUID() })
    expect(clearCaches).toHaveBeenCalled()
  })
})
