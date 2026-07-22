import { describe, it, expect, beforeEach } from "vitest"
import { Effect, Exit, Cause } from "effect"
import { resetDb, testDb } from "./setup"
import {
  createCustomer,
  createCustomerWithTxid,
  getCustomer,
  updateCustomer,
  listCustomers,
  searchCustomers,
  changeCustomerStatus,
} from "@/services/customer.service"
import { CustomerNotFound } from "@/lib/errors"
import { auditLog } from "@/lib/db/schema/audit"
import { eq } from "drizzle-orm"
import crypto from "node:crypto"

const TEST_TIMEOUT = 30_000
const makeNin = (n: number) => `C${n.toString().padStart(13, "0")}`

describe("Customer Service (integration)", () => {
  beforeEach(async () => {
    await resetDb()
  }, TEST_TIMEOUT)

  // ── 1. createCustomer ────────────────────────────────────────────────
  it("inserts a real customer and returns all fields", async () => {
    const customer = await Effect.runPromise(
      createCustomer({
        fullName: "Alice Nakato",
        nin: makeNin(0),
        contact: "+256771000001",
        address: "Kampala, Uganda",
      })
    )

    expect(customer.id).toBeDefined()
    expect(customer.fullName).toBe("Alice Nakato")
    expect(customer.nin).toBe(makeNin(0))
    expect(customer.contact).toBe("0771000001")
    expect(customer.address).toBe("Kampala, Uganda")
    expect(customer.status).toBe("active")
    expect(customer.createdAt).toBeInstanceOf(Date)
    expect(customer.updatedAt).toBeInstanceOf(Date)
  }, TEST_TIMEOUT)

  // ── 1b. createCustomerWithTxid ───────────────────────────────────────
  it("createCustomerWithTxid returns customer + a numeric Postgres txid", async () => {
    const result = await Effect.runPromise(
      createCustomerWithTxid({
        id: crypto.randomUUID(),
        fullName: "Txid Tester",
        nin: makeNin(99),
        contact: "0771234567",
        address: "Kampala, Uganda",
      })
    )

    expect(result.customer.id).toBeDefined()
    expect(result.customer.fullName).toBe("Txid Tester")
    expect(result.customer.nin).toBe(makeNin(99))
    expect(typeof result.txid).toBe("number")
    expect(Number.isFinite(result.txid)).toBe(true)
    expect(result.txid).toBeGreaterThan(0)

    // Verify the customer is actually persisted
    const fetched = await Effect.runPromise(getCustomer(result.customer.id))
    expect(fetched.id).toBe(result.customer.id)
  }, TEST_TIMEOUT)

  // ── 2. getCustomer ──────────────────────────────────────────────────
  it("fetches a customer by id", async () => {
    const created = await Effect.runPromise(
      createCustomer({
        fullName: "Bob Ssempa",
        nin: makeNin(1),
        contact: "+256772000002",
        address: "Entebbe, Uganda",
      })
    )

    const fetched = await Effect.runPromise(getCustomer(created.id))

    expect(fetched.id).toBe(created.id)
    expect(fetched.fullName).toBe("Bob Ssempa")
    expect(fetched.contact).toBe("0772000002")
    expect(fetched.address).toBe("Entebbe, Uganda")
  }, TEST_TIMEOUT)

  // ── 3. getCustomer with bad id ──────────────────────────────────────
  it("returns CustomerNotFound for a non-existent id", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(getCustomer(fakeId))

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CustomerNotFound)
        expect((error.value as CustomerNotFound).id).toBe(fakeId)
      }
    }
  }, TEST_TIMEOUT)

  // ── 4. updateCustomer ───────────────────────────────────────────────
  it("updates a customer and persists the change", async () => {
    const created = await Effect.runPromise(
      createCustomer({
        fullName: "Carol Apio",
        nin: makeNin(2),
        contact: "+256773000003",
        address: "Gulu, Uganda",
      })
    )

    const updated = await Effect.runPromise(
      updateCustomer(created.id, { fullName: "Carol Apio-Okello" }, "admin-1")
    )

    expect(updated.fullName).toBe("Carol Apio-Okello")
    expect(updated.contact).toBe("0773000003") // unchanged

    // Verify persistence via a fresh fetch
    const refetched = await Effect.runPromise(getCustomer(created.id))
    expect(refetched.fullName).toBe("Carol Apio-Okello")

    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, created.id))

    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe("customer.update")
    expect(logs[0].actorId).toBe("admin-1")
    expect(JSON.parse(logs[0].beforeValue!)).toEqual({
      fullName: "Carol Apio",
      nin: makeNin(2),
      contact: "0773000003",
      address: "Gulu, Uganda",
    })
    expect(JSON.parse(logs[0].afterValue!)).toEqual({
      fullName: "Carol Apio-Okello",
      nin: makeNin(2),
      contact: "0773000003",
      address: "Gulu, Uganda",
    })
  }, TEST_TIMEOUT)

  // ── 5. updateCustomer with bad id ──────────────────────────────────
  it("returns CustomerNotFound when updating a non-existent customer", async () => {
    const fakeId = crypto.randomUUID()
    const exit = await Effect.runPromiseExit(
      updateCustomer(fakeId, { fullName: "Nobody" }, "admin-1")
    )

    expect(Exit.isFailure(exit)).toBe(true)

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause)
      expect(error._tag).toBe("Some")
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CustomerNotFound)
      }
    }
  }, TEST_TIMEOUT)

  // ── 6. listCustomers ────────────────────────────────────────────────
  it("lists all customers", async () => {
    await Effect.runPromise(
      createCustomer({ fullName: "Dan Obol", nin: makeNin(10), contact: "0774000004", address: "Lira" })
    )
    await Effect.runPromise(
      createCustomer({ fullName: "Eva Kizza", nin: makeNin(11), contact: "0775000005", address: "Jinja" })
    )
    await Effect.runPromise(
      createCustomer({ fullName: "Frank Mwebe", nin: makeNin(12), contact: "0776000006", address: "Mbale" })
    )

    const list = await Effect.runPromise(listCustomers())
    expect(list).toHaveLength(3)

    const names = list.map((c) => c.fullName).sort()
    expect(names).toEqual(["Dan Obol", "Eva Kizza", "Frank Mwebe"])
  }, TEST_TIMEOUT)

  // ── 7. searchCustomers by query ──────────────────────────────────────
  it("filters customers by name, NIN, and phone number", async () => {
    await Effect.runPromise(
      createCustomer({ fullName: "Grace Atim", nin: makeNin(20), contact: "0777000007", address: "Soroti" })
    )
    await Effect.runPromise(
      createCustomer({ fullName: "Grace Nambi", nin: makeNin(21), contact: "0778000008", address: "Masaka" })
    )
    await Effect.runPromise(
      createCustomer({ fullName: "Henry Kato", nin: makeNin(22), contact: "0779000009", address: "Mbarara" })
    )

    const result = await Effect.runPromise(searchCustomers({ name: "Grace" }))

    expect(result.rows).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(result.rows.every((c) => c.fullName.includes("Grace"))).toBe(true)

    const ninResult = await Effect.runPromise(searchCustomers({ name: makeNin(21) }))
    expect(ninResult.rows).toHaveLength(1)
    expect(ninResult.total).toBe(1)
    expect(ninResult.rows[0].fullName).toBe("Grace Nambi")

    const phoneResult = await Effect.runPromise(searchCustomers({ name: "+256779000009" }))
    expect(phoneResult.rows).toHaveLength(1)
    expect(phoneResult.total).toBe(1)
    expect(phoneResult.rows[0].fullName).toBe("Henry Kato")
  }, TEST_TIMEOUT)

  // ── 8. searchCustomers by status ────────────────────────────────────
  it("filters customers by status", async () => {
    await Effect.runPromise(
      createCustomer({ fullName: "Irene Nanteza", nin: makeNin(30), contact: "0780000010", address: "Wakiso" })
    )
    await Effect.runPromise(
      createCustomer({ fullName: "James Lwanga", nin: makeNin(31), contact: "0781000011", address: "Mukono" })
    )

    // All customers default to "active"
    const activeResult = await Effect.runPromise(
      searchCustomers({ status: ["active"] })
    )
    expect(activeResult.rows).toHaveLength(2)
    expect(activeResult.total).toBe(2)

    // No blacklisted customers
    const blacklistedResult = await Effect.runPromise(
      searchCustomers({ status: ["blacklisted"] })
    )
    expect(blacklistedResult.rows).toHaveLength(0)
    expect(blacklistedResult.total).toBe(0)
  }, TEST_TIMEOUT)

  // ── 9. searchCustomers pagination ───────────────────────────────────
  it("paginates search results", async () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]
    for (const [index, name] of names.entries()) {
      await Effect.runPromise(
        createCustomer({
          fullName: name,
          nin: makeNin(40 + index),
          contact: `07700000${index + 10}`,
          address: "Kampala",
        })
      )
    }

    const page0 = await Effect.runPromise(
      searchCustomers({ pageSize: 2, page: 0 })
    )
    expect(page0.rows).toHaveLength(2)
    expect(page0.total).toBe(5)

    const page1 = await Effect.runPromise(
      searchCustomers({ pageSize: 2, page: 1 })
    )
    expect(page1.rows).toHaveLength(2)
    expect(page1.total).toBe(5)

    const page2 = await Effect.runPromise(
      searchCustomers({ pageSize: 2, page: 2 })
    )
    expect(page2.rows).toHaveLength(1)
    expect(page2.total).toBe(5)

    // No overlap between pages
    const allIds = [
      ...page0.rows.map((c) => c.id),
      ...page1.rows.map((c) => c.id),
      ...page2.rows.map((c) => c.id),
    ]
    expect(new Set(allIds).size).toBe(5)
  }, TEST_TIMEOUT)

  // ── 10. changeCustomerStatus + audit log ────────────────────────────
  it("changes status to blacklisted and writes an audit log entry", async () => {
    const customer = await Effect.runPromise(
      createCustomer({ fullName: "Kevin Opoka", nin: makeNin(50), contact: "0782000012", address: "Arua" })
    )

    const updated = await Effect.runPromise(
      changeCustomerStatus(customer.id, "blacklisted", "Repeated defaults", "admin-1")
    )

    expect(updated.status).toBe("blacklisted")

    // Verify via fresh fetch
    const refetched = await Effect.runPromise(getCustomer(customer.id))
    expect(refetched.status).toBe("blacklisted")

    // Verify audit log row
    const logs = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, customer.id))

    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe("status_change")
    expect(logs[0].actorId).toBe("admin-1")
    expect(logs[0].entityType).toBe("customer")
    // writeAuditLog double-stringifies: changeCustomerStatus passes a
    // JSON.stringify'd string, and writeAuditLog calls JSON.stringify again.
    expect(JSON.parse(JSON.parse(logs[0].beforeValue!))).toEqual({
      status: "active",
    })
    expect(JSON.parse(JSON.parse(logs[0].afterValue!))).toEqual({
      status: "blacklisted",
      reason: "Repeated defaults",
    })
  }, TEST_TIMEOUT)
})
