"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import { getDashboardKPIs, getRecentActivity } from "@/services/dashboard.service"
import { getActivities } from "@/services/activity.service"
import type { ActivityFeedItem } from "@/types/dashboard"
import type { ActivityItem } from "@/types/activity"

/**
 * Union return shape for the dashboard activity feed.
 *
 * Supervisors+ see audit-log derived `ActivityItem`s (with actor/occurredAt);
 * loan officers see the simpler `ActivityFeedItem` stream. Callers narrow on
 * presence of `occurredAt` vs `timestamp` when rendering.
 */
export type DashboardActivityFeed =
  | { items: ActivityItem[]; total: number }
  | { items: ActivityFeedItem[]; total: number }

export const getDashboardAction = withAction({
  permission: "dashboard:read",
  effect: () => Effect.map(getDashboardKPIs(), (kpis) => ({ kpis })),
  errors: { DatabaseError: "Database error" },
})

export const getDashboardActivityAction = withAction({
  permission: "dashboard:read",
  effect: (session): Effect.Effect<DashboardActivityFeed, Error> => {
    const role = session.user.role
    const hasActivityRead = role === "supervisor" || role === "admin" || role === "superAdmin"

    if (hasActivityRead) {
      return getActivities({ page: 1, pageSize: 3, viewerRole: role })
    }
    // Loan officers see general recent activity (current behavior)
    return getRecentActivity(1, 3)
  },
  errors: { DatabaseError: "Database error" },
})

// Keep old action for backwards compat during transition
export async function getRecentActivityAction(page = 1, pageSize = 10) {
  return getRecentActivityWrapped({ page, pageSize })
}

const getRecentActivityWrapped = withAction<
  { page: number; pageSize: number },
  { items: ActivityFeedItem[]; total: number }
>({
  permission: "dashboard:read",
  effect: (_session, { page, pageSize }) => getRecentActivity(page, pageSize),
  errors: { DatabaseError: "Database error" },
})
