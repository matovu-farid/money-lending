/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { QueryClient } from "@tanstack/react-query"

// --- Mock @electric-sql/client ----------------------------------------------
// Each constructed ShapeStream stores its (messageHandler, errorHandler) pair
// so tests can drive messages manually via `streams[i].emit(...)`.
type MessageHandler = (messages: unknown[]) => void
type ErrorHandler = (err: unknown) => void

interface FakeStream {
  url: string
  messageHandler: MessageHandler | null
  errorHandler: ErrorHandler | null
  emit: (messages: unknown[]) => void
}

const streams: FakeStream[] = []

vi.mock("@electric-sql/client", () => {
  return {
    ShapeStream: class {
      url: string
      messageHandler: MessageHandler | null = null
      errorHandler: ErrorHandler | null = null
      constructor(opts: { url: string }) {
        this.url = opts.url
        const fake: FakeStream = {
          url: opts.url,
          messageHandler: null,
          errorHandler: null,
          emit: (messages: unknown[]) => {
            this.messageHandler?.(messages)
          },
        }
        // Bridge: expose to streams array, then keep handlers in sync.
        streams.push(fake)
        // Self-reference so subscribe() below mutates the shared fake.
        ;(this as unknown as { _fake: FakeStream })._fake = fake
      }
      subscribe(messageHandler: MessageHandler, errorHandler: ErrorHandler) {
        this.messageHandler = messageHandler
        this.errorHandler = errorHandler
        const fake = (this as unknown as { _fake: FakeStream })._fake
        fake.messageHandler = messageHandler
        fake.errorHandler = errorHandler
        fake.emit = (messages: unknown[]) => messageHandler(messages)
      }
    },
  }
})

// --- Minimal QueryClient mock -----------------------------------------------
function makeQueryClient() {
  const calls: { queryKey: unknown[] }[] = []
  const client = {
    invalidateQueries: vi.fn(({ queryKey }: { queryKey: unknown[] }) => {
      calls.push({ queryKey })
      return Promise.resolve()
    }),
  } as unknown as QueryClient & {
    invalidateQueries: ReturnType<typeof vi.fn>
  }
  return { client, calls }
}

const upToDateMessage = [
  { headers: { control: "up-to-date" } },
] as unknown[]

const liveChange = [
  { key: "row-1", value: { id: 1 }, headers: { operation: "insert" } },
] as unknown[]

// Helper: yield to the microtask queue so queueMicrotask callbacks run.
const flushMicrotasks = () => Promise.resolve()

// Each test gets a fresh module so the module-level Maps are reset.
async function loadFreshModule() {
  streams.length = 0
  vi.resetModules()
  return await import("./electric")
}

beforeEach(() => {
  streams.length = 0
})

describe("subscribeToTableChanges — coalesced invalidation", () => {
  it("invalidates a shared key only ONCE when two tables tick in the same turn", async () => {
    const { subscribeToTableChanges } = await loadFreshModule()
    const { client, calls } = makeQueryClient()

    const sharedKey = ["dashboard", "kpis"] as const

    subscribeToTableChanges("loans", client, [sharedKey])
    subscribeToTableChanges("payments", client, [sharedKey])

    expect(streams).toHaveLength(2)
    const [loansStream, paymentsStream] = streams

    // Complete initial sync on both streams (these messages must NOT invalidate).
    loansStream.emit(upToDateMessage)
    paymentsStream.emit(upToDateMessage)

    // Same JS turn: both streams report a live change.
    loansStream.emit(liveChange)
    paymentsStream.emit(liveChange)

    // Coalescing happens via queueMicrotask — flush it.
    await flushMicrotasks()

    expect(calls).toHaveLength(1)
    expect(calls[0].queryKey).toEqual([...sharedKey])
  })

  it("invalidates each unique key once when two different keys are registered", async () => {
    const { subscribeToTableChanges } = await loadFreshModule()
    const { client, calls } = makeQueryClient()

    const keyA = ["dashboard", "kpis"] as const
    const keyB = ["dashboard", "collections"] as const

    subscribeToTableChanges("loans", client, [keyA, keyB])

    expect(streams).toHaveLength(1)
    const [loansStream] = streams

    loansStream.emit(upToDateMessage) // initial sync
    loansStream.emit(liveChange) // live tick

    await flushMicrotasks()

    expect(calls).toHaveLength(2)
    const seen = calls.map((c) => c.queryKey)
    expect(seen).toContainEqual([...keyA])
    expect(seen).toContainEqual([...keyB])
  })

  it("does NOT invalidate during the initial sync phase", async () => {
    const { subscribeToTableChanges } = await loadFreshModule()
    const { client, calls } = makeQueryClient()

    subscribeToTableChanges("loans", client, [["dashboard", "kpis"] as const])

    expect(streams).toHaveLength(1)
    const [loansStream] = streams

    // First message stream is the initial snapshot — even if it contains rows,
    // there's no "up-to-date" yet, so nothing should invalidate.
    loansStream.emit([{ key: "row-1", value: { id: 1 }, headers: { operation: "insert" } }])
    // Then up-to-date arrives — also must not trigger invalidation (it only flips the flag).
    loansStream.emit(upToDateMessage)

    await flushMicrotasks()

    expect(calls).toHaveLength(0)
  })

  it("a second tick AFTER the microtask flush produces a fresh invalidation", async () => {
    const { subscribeToTableChanges } = await loadFreshModule()
    const { client, calls } = makeQueryClient()

    const sharedKey = ["dashboard", "kpis"] as const

    subscribeToTableChanges("loans", client, [sharedKey])
    subscribeToTableChanges("payments", client, [sharedKey])

    const [loansStream, paymentsStream] = streams

    loansStream.emit(upToDateMessage)
    paymentsStream.emit(upToDateMessage)

    // Turn 1: both streams tick.
    loansStream.emit(liveChange)
    paymentsStream.emit(liveChange)
    await flushMicrotasks()
    expect(calls).toHaveLength(1)

    // Turn 2: another live change arrives — coalescing window has reset, so we
    // should see a fresh invalidation.
    loansStream.emit(liveChange)
    await flushMicrotasks()
    expect(calls).toHaveLength(2)
    expect(calls[1].queryKey).toEqual([...sharedKey])
  })
})
