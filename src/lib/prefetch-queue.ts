/**
 * Global priority prefetch queue.
 *
 * Accepts async functions with a priority level and executes them one at a
 * time, highest priority first, with a delay between each so background data
 * loading never competes with user-initiated requests.
 *
 * Priority levels (lower number = higher priority):
 *   0  CRITICAL  — User is about to navigate (hover, focus)
 *   1  HIGH      — Core page data (dashboard KPIs, loans list, customers list)
 *   2  NORMAL    — Secondary page data (creditors, expenses, fund transfers)
 *   3  LOW       — Background prefetch (individual loan details, speculative)
 *
 * Usage:
 *   import { prefetchQueue, Priority } from "@/lib/prefetch-queue"
 *   prefetchQueue.add(() => queryClient.prefetchQuery({ ... }), Priority.HIGH)
 *   prefetchQueue.add(() => router.prefetch("/loans"), Priority.NORMAL)
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
}

const DELAY_MS: Record<PriorityLevel, number> = {
  [Priority.CRITICAL]: 50,
  [Priority.HIGH]: 150,
  [Priority.NORMAL]: 300,
  [Priority.LOW]: 400,
}

const MAX_QUEUE = 200

let queue: QueueEntry[] = []
let running = false
let timeoutId: ReturnType<typeof setTimeout> | null = null

function pickNext(): QueueEntry | undefined {
  if (queue.length === 0) return undefined
  // Find the highest-priority (lowest number) entry
  let bestIdx = 0
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].priority < queue[bestIdx].priority) {
      bestIdx = i
    }
  }
  return queue.splice(bestIdx, 1)[0]
}

async function flush() {
  if (running) return
  running = true

  while (queue.length > 0) {
    const entry = pickNext()!
    try {
      await entry.fn()
    } catch {
      // prefetch failures are non-critical — swallow silently
    }
    if (queue.length > 0) {
      const delay = DELAY_MS[entry.priority]
      await new Promise((r) => { timeoutId = setTimeout(r, delay) })
    }
  }

  running = false
  timeoutId = null
}

function add(fn: PrefetchFn, priority: PriorityLevel = Priority.LOW) {
  if (queue.length >= MAX_QUEUE) return
  queue.push({ fn, priority })
  if (!running && timeoutId === null) {
    timeoutId = setTimeout(flush, 50)
  }
}

function clear() {
  queue = []
  if (timeoutId !== null) {
    clearTimeout(timeoutId)
    timeoutId = null
  }
}

function size() {
  return queue.length
}

export const prefetchQueue = { add, clear, size }
