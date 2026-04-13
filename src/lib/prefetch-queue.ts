/**
 * Global priority prefetch queue with deduplication, debouncing, navigation
 * awareness, and idle-time scheduling.
 *
 * Accepts async functions with a priority level and a dedup key. Executes them
 * one at a time during browser idle periods so prefetching never competes with
 * user-initiated requests or navigation.
 *
 * Key features:
 *   - **Dedup:**     Same key is never queued twice simultaneously
 *   - **Debounce:**  Recently completed keys are skipped for a configurable window
 *   - **Pause:**     Queue pauses during navigation and resumes after
 *   - **Idle:**      Uses requestIdleCallback so prefetches only run when the
 *                    main thread is idle — real fetches always take priority
 *   - **Timeout:**   Each prefetch call has a max execution time
 *
 * Priority levels (lower number = higher priority):
 *   0  CRITICAL  — User is about to navigate (hover, focus)
 *   1  HIGH      — Core page data (dashboard KPIs, loans list, customers list)
 *   2  NORMAL    — Secondary page data (creditors, expenses, fund transfers)
 *   3  LOW       — Background prefetch (individual loan details, speculative)
 *
 * Usage:
 *   import { prefetchQueue, Priority } from "@/lib/prefetch-queue"
 *   prefetchQueue.add(() => queryClient.prefetchQuery({ ... }), Priority.HIGH, "dashboard-kpis")
 *   prefetchQueue.add(() => router.prefetch("/loans"), Priority.NORMAL, "route:/loans")
 */

type PrefetchFn = () => Promise<unknown> | unknown

export const Priority = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
} as const

export type PriorityLevel = (typeof Priority)[keyof typeof Priority]

interface QueueEntry {
  fn: PrefetchFn
  priority: PriorityLevel
  key: string | undefined
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Delay between consecutive prefetch executions, per priority */
const DELAY_MS: Record<PriorityLevel, number> = {
  [Priority.CRITICAL]: 50,
  [Priority.HIGH]: 150,
  [Priority.NORMAL]: 300,
  [Priority.LOW]: 400,
}

/** Don't re-queue the same key within this window after completion */
const DEBOUNCE_WINDOW_MS = 30_000

/** Max time a single prefetch function is allowed to run */
const TASK_TIMEOUT_MS = 8_000

/** Max items in the queue */
const MAX_QUEUE = 200

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let queue: QueueEntry[] = []
let running = false
let paused = false
let scheduleHandle: ReturnType<typeof setTimeout> | number | null = null

/** Keys currently sitting in the queue (not yet executed) */
const pendingKeys = new Set<string>()

/** Keys that completed recently — maps key → completion timestamp */
const completedKeys = new Map<string, number>()

// ---------------------------------------------------------------------------
// Idle scheduling helpers
// ---------------------------------------------------------------------------

const hasIdleCallback = typeof globalThis !== "undefined" && "requestIdleCallback" in globalThis

function scheduleFlush() {
  if (running || paused || scheduleHandle !== null || queue.length === 0) return
  if (hasIdleCallback) {
    // Schedule during idle time — browser guarantees this won't compete with
    // layout, paint, or user-initiated fetches
    scheduleHandle = requestIdleCallback(() => {
      scheduleHandle = null
      flush()
    }, { timeout: 2_000 })
  } else {
    scheduleHandle = setTimeout(() => {
      scheduleHandle = null
      flush()
    }, 50)
  }
}

function cancelSchedule() {
  if (scheduleHandle === null) return
  if (hasIdleCallback) {
    cancelIdleCallback(scheduleHandle as number)
  } else {
    clearTimeout(scheduleHandle as ReturnType<typeof setTimeout>)
  }
  scheduleHandle = null
}

// ---------------------------------------------------------------------------
// Core flush loop
// ---------------------------------------------------------------------------

function pickNext(): QueueEntry | undefined {
  if (queue.length === 0) return undefined
  let bestIdx = 0
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].priority < queue[bestIdx].priority) {
      bestIdx = i
    }
  }
  const entry = queue.splice(bestIdx, 1)[0]
  if (entry.key) pendingKeys.delete(entry.key)
  return entry
}

function runWithTimeout(fn: PrefetchFn): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, TASK_TIMEOUT_MS)
    try {
      const result = fn()
      if (result && typeof (result as Promise<unknown>).then === "function") {
        ;(result as Promise<unknown>).then(
          () => { clearTimeout(timer); resolve() },
          () => { clearTimeout(timer); resolve() },
        )
      } else {
        clearTimeout(timer)
        resolve()
      }
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

async function flush() {
  if (running || paused) return
  running = true

  while (queue.length > 0 && !paused) {
    const entry = pickNext()!
    await runWithTimeout(entry.fn)

    // Record completion for debounce
    if (entry.key) {
      completedKeys.set(entry.key, Date.now())
    }

    // Delay between tasks — yield to the main thread
    if (queue.length > 0 && !paused) {
      const delay = DELAY_MS[entry.priority]
      await new Promise<void>((r) => setTimeout(r, delay))
    }
  }

  running = false

  // If items were added while we were finishing, reschedule
  if (queue.length > 0 && !paused) {
    scheduleFlush()
  }
}

// ---------------------------------------------------------------------------
// Periodic cleanup of the completedKeys map (prevent memory leak)
// ---------------------------------------------------------------------------

function pruneCompletedKeys() {
  const cutoff = Date.now() - DEBOUNCE_WINDOW_MS
  for (const [key, ts] of completedKeys) {
    if (ts < cutoff) completedKeys.delete(key)
  }
}

// Run prune every 60s in browsers
if (typeof globalThis !== "undefined" && typeof setInterval !== "undefined") {
  setInterval(pruneCompletedKeys, 60_000)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a prefetch task to the queue.
 *
 * @param fn       Async function that performs the prefetch
 * @param priority Priority level (default: LOW)
 * @param key      Optional dedup/debounce key. If provided:
 *                 - Skipped if the same key is already in the queue
 *                 - Skipped if the same key completed within the debounce window
 */
function add(fn: PrefetchFn, priority: PriorityLevel = Priority.LOW, key?: string) {
  if (paused) return
  if (queue.length >= MAX_QUEUE) return

  if (key) {
    // Dedup: already queued
    if (pendingKeys.has(key)) return
    // Debounce: completed recently
    const completedAt = completedKeys.get(key)
    if (completedAt && Date.now() - completedAt < DEBOUNCE_WINDOW_MS) return
    pendingKeys.add(key)
  }

  queue.push({ fn, priority, key })
  scheduleFlush()
}

/**
 * Pause the queue. No new tasks will be accepted or executed.
 * Call this before navigation starts.
 */
function pause() {
  paused = true
  cancelSchedule()
}

/**
 * Resume the queue after navigation completes.
 */
function resume() {
  paused = false
  if (queue.length > 0) {
    scheduleFlush()
  }
}

/** Whether the queue is currently paused */
function isPaused() {
  return paused
}

/** Clear all pending tasks */
function clear() {
  queue = []
  pendingKeys.clear()
  cancelSchedule()
}

/** Number of pending tasks */
function size() {
  return queue.length
}

/** Reset debounce state for a specific key (e.g. after mutation invalidation) */
function resetKey(key: string) {
  completedKeys.delete(key)
}

export const prefetchQueue = { add, pause, resume, isPaused, clear, size, resetKey }
