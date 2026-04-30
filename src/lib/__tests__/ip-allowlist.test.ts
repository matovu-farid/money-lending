import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  getClientIp,
  isIpAllowlistEnabled,
  isIpAllowed,
  recordAdminLoginIp,
  recordBlock,
  clearCaches,
  __setIpAllowlistDepsForTests,
} from "@/lib/ip-allowlist"

describe("getClientIp", () => {
  it("returns the first entry of x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })
    expect(getClientIp(h)).toBe("203.0.113.7")
  })

  it("trims whitespace", () => {
    const h = new Headers({ "x-forwarded-for": "  203.0.113.7  ,10.0.0.1" })
    expect(getClientIp(h)).toBe("203.0.113.7")
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const h = new Headers({ "x-real-ip": "203.0.113.42" })
    expect(getClientIp(h)).toBe("203.0.113.42")
  })

  it("returns null when neither header is present", () => {
    expect(getClientIp(new Headers())).toBeNull()
  })

  it("returns null on empty x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "" })
    expect(getClientIp(h)).toBeNull()
  })
})

describe("isIpAllowlistEnabled", () => {
  beforeEach(() => clearCaches())

  it("returns false when system_settings has no row", async () => {
    __setIpAllowlistDepsForTests({
      readSetting: vi.fn().mockResolvedValue(null),
    })
    expect(await isIpAllowlistEnabled()).toBe(false)
  })

  it('returns true when value is "true"', async () => {
    __setIpAllowlistDepsForTests({
      readSetting: vi.fn().mockResolvedValue("true"),
    })
    expect(await isIpAllowlistEnabled()).toBe(true)
  })

  it("caches across calls within TTL", async () => {
    const readSetting = vi.fn().mockResolvedValue("true")
    __setIpAllowlistDepsForTests({ readSetting })
    await isIpAllowlistEnabled()
    await isIpAllowlistEnabled()
    expect(readSetting).toHaveBeenCalledTimes(1)
  })

  it("clearCaches forces a re-read", async () => {
    const readSetting = vi.fn().mockResolvedValue("true")
    __setIpAllowlistDepsForTests({ readSetting })
    await isIpAllowlistEnabled()
    clearCaches()
    await isIpAllowlistEnabled()
    expect(readSetting).toHaveBeenCalledTimes(2)
  })

  it("fails open (returns false) when read throws", async () => {
    __setIpAllowlistDepsForTests({
      readSetting: vi.fn().mockRejectedValue(new Error("db down")),
    })
    expect(await isIpAllowlistEnabled()).toBe(false)
  })
})

describe("isIpAllowed", () => {
  beforeEach(() => clearCaches())

  it("returns true when IP exists in any admin queue", async () => {
    __setIpAllowlistDepsForTests({
      ipExists: vi.fn().mockResolvedValue(true),
    })
    expect(await isIpAllowed("203.0.113.7")).toBe(true)
  })

  it("returns false when IP is missing", async () => {
    __setIpAllowlistDepsForTests({
      ipExists: vi.fn().mockResolvedValue(false),
    })
    expect(await isIpAllowed("203.0.113.7")).toBe(false)
  })

  it("caches per-IP within TTL", async () => {
    const ipExists = vi.fn().mockResolvedValue(true)
    __setIpAllowlistDepsForTests({ ipExists })
    await isIpAllowed("203.0.113.7")
    await isIpAllowed("203.0.113.7")
    expect(ipExists).toHaveBeenCalledTimes(1)
  })

  it("fails closed (returns false) when read throws", async () => {
    __setIpAllowlistDepsForTests({
      ipExists: vi.fn().mockRejectedValue(new Error("db down")),
    })
    expect(await isIpAllowed("203.0.113.7")).toBe(false)
  })
})

describe("recordAdminLoginIp", () => {
  beforeEach(() => clearCaches())

  it("upserts and bumps last_seen_at on duplicate", async () => {
    const upsert = vi.fn().mockResolvedValue({ inserted: false })
    __setIpAllowlistDepsForTests({ upsertAllowlist: upsert })
    await recordAdminLoginIp("user-1", "203.0.113.7")
    expect(upsert).toHaveBeenCalledWith("user-1", "203.0.113.7")
  })

  it("trims to 100 oldest entries when over cap", async () => {
    const upsert = vi.fn().mockResolvedValue({ inserted: true })
    const trim = vi.fn().mockResolvedValue(undefined)
    __setIpAllowlistDepsForTests({ upsertAllowlist: upsert, trimAllowlist: trim })
    await recordAdminLoginIp("user-1", "203.0.113.7")
    expect(trim).toHaveBeenCalledWith("user-1", 100)
  })

  it("does not trim when upsert was a dup (no new row)", async () => {
    const upsert = vi.fn().mockResolvedValue({ inserted: false })
    const trim = vi.fn().mockResolvedValue(undefined)
    __setIpAllowlistDepsForTests({ upsertAllowlist: upsert, trimAllowlist: trim })
    await recordAdminLoginIp("user-1", "203.0.113.7")
    expect(trim).not.toHaveBeenCalled()
  })

  it("swallows DB errors (must never throw — login depends on it)", async () => {
    __setIpAllowlistDepsForTests({
      upsertAllowlist: vi.fn().mockRejectedValue(new Error("db down")),
    })
    await expect(recordAdminLoginIp("user-1", "203.0.113.7")).resolves.toBeUndefined()
  })

  it("invalidates the IP cache after a new insert", async () => {
    const ipExists = vi.fn().mockResolvedValue(false)
    const upsert = vi.fn().mockResolvedValue({ inserted: true })
    __setIpAllowlistDepsForTests({ ipExists, upsertAllowlist: upsert })

    await isIpAllowed("203.0.113.7") // primes cache: false
    expect(ipExists).toHaveBeenCalledTimes(1)

    ipExists.mockResolvedValueOnce(true)
    await recordAdminLoginIp("user-1", "203.0.113.7")
    const allowed = await isIpAllowed("203.0.113.7")
    expect(allowed).toBe(true)
    expect(ipExists).toHaveBeenCalledTimes(2)
  })
})

describe("recordBlock", () => {
  it("inserts and never throws", async () => {
    const insert = vi.fn().mockResolvedValue(undefined)
    __setIpAllowlistDepsForTests({ insertBlock: insert })
    await recordBlock("user-1", "203.0.113.99", "/dashboard")
    expect(insert).toHaveBeenCalledWith("user-1", "203.0.113.99", "/dashboard")
  })

  it("swallows errors", async () => {
    __setIpAllowlistDepsForTests({
      insertBlock: vi.fn().mockRejectedValue(new Error("db down")),
    })
    await expect(recordBlock("u", "ip", "/x")).resolves.toBeUndefined()
  })
})
