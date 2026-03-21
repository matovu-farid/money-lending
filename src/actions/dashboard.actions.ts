"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { getDashboardKPIs, getRecentActivity } from "@/services/dashboard.service"
import { DatabaseError } from "@/lib/errors"

export async function getDashboardAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { error: "Unauthorized" }
  }

  try {
    const [kpis, activity] = await Promise.all([
      Effect.runPromise(getDashboardKPIs()),
      Effect.runPromise(getRecentActivity()),
    ])
    return { data: { kpis, activity } }
  } catch (error) {
    if (error instanceof DatabaseError) {
      return { error: "Database error" }
    }
    return { error: "Internal server error" }
  }
}
