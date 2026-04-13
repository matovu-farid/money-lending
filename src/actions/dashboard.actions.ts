"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getDashboardKPIs, getRecentActivity } from "@/services/dashboard.service"

export const getDashboardAction = withAction({
  permission: "dashboard:read",
  effect: () => Effect.map(getDashboardKPIs(), (kpis) => ({ kpis })),
  errors: { DatabaseError: "Database error" },
})

export async function getRecentActivityAction(page = 1, pageSize = 10) {
  // This action has a multi-arg signature that doesn't fit withAction cleanly.
  // We use withAction with a tuple input to keep the auth wrapper.
  return getRecentActivityWrapped({ page, pageSize })
}

const getRecentActivityWrapped = withAction<{ page: number; pageSize: number }, any>({
  permission: "dashboard:read",
  effect: (_session, { page, pageSize }) => getRecentActivity(page, pageSize),
  errors: { DatabaseError: "Database error" },
})
