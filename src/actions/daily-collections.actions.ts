"use server"

import { Effect } from "effect"
import { getSession } from "@/lib/action-utils"
import {
  getDailyCollections,
  getLoansDueToday,
} from "@/services/daily-collections.service"

export async function getDailyCollectionsAction(date: string) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  if (!date?.trim() || isNaN(Date.parse(date))) {
    return { error: "Invalid date" }
  }

  try {
    const data = await Effect.runPromise(getDailyCollections(date))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function getLoansDueTodayAction() {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(getLoansDueToday())
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}
