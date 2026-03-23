"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import {
  getDailyCollections,
  getLoansDueToday,
} from "@/services/daily-collections.service"

/**
 * Returns daily collections summary for a given YYYY-MM-DD date string.
 * Auth required — returns { error: "Unauthorized" } if not logged in.
 *
 * COLL-01: Daily collections server action.
 */
export async function getDailyCollectionsAction(date: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(getDailyCollections(date))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

/**
 * Returns all active loans where last payment (or start date) was 30+ days ago.
 * Auth required — returns { error: "Unauthorized" } if not logged in.
 *
 * COLL-03: Due-today loans server action.
 */
export async function getLoansDueTodayAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(getLoansDueToday())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
