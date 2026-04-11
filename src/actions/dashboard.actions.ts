"use server"

import { Effect } from "effect"
import { getSession } from "@/lib/action-utils"
import { getDashboardKPIs, getRecentActivity } from "@/services/dashboard.service"
import { DatabaseError } from "@/lib/errors"

export async function getDashboardAction() {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  try {
    const kpis = await Effect.runPromise(getDashboardKPIs())
    return { data: { kpis } }
  } catch (error) {
    if (error instanceof DatabaseError) {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}

export async function getRecentActivityAction(page = 1, pageSize = 10) {
  const session = await getSession()
  if (!session) {
    return { error: "Unauthorized" }
  }

  try {
    const data = await Effect.runPromise(getRecentActivity(page, pageSize))
    return { data }
  } catch (error) {
    if (error instanceof DatabaseError) {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}
