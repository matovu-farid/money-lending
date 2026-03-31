"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import {
  getDailyCollections,
  getLoansDueToday,
} from "@/services/daily-collections.service"

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
