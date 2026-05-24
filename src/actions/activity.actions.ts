"use server"

import { withAction, type Session } from "@/lib/with-action"
import { getActivities } from "@/services/activity.service"
import { getUserRole } from "@/lib/action-utils"
import type { GetActivitiesInput } from "@/types/activity"

export const getActivitiesAction = withAction({
  permission: "activity:read",
  effect: (session: Session, input: GetActivitiesInput) =>
    getActivities({ ...input, viewerRole: getUserRole(session) }),
  errors: { DatabaseError: "Database error" },
})
