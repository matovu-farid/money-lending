"use server"

import { withAction } from "@/lib/with-action"
import { getActivities } from "@/services/activity.service"
import type { GetActivitiesInput } from "@/types/activity"

export const getActivitiesAction = withAction<GetActivitiesInput, any>({
  permission: "activity:read",
  effect: (session, input) =>
    getActivities({ ...input, viewerRole: (session.user as any).role ?? "unassigned" }),
  errors: { DatabaseError: "Database error" },
})
