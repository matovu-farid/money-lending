"use server"

import { Effect } from "effect"
import { withAction } from "@/lib/with-action"
import {
  getDailyCollections,
  getLoansDueToday,
} from "@/services/daily-collections.service"

export const getDailyCollectionsAction = withAction<string, any>({
  permission: "payment:read",
  action: async (_session, date) => {
    if (!date?.trim() || isNaN(Date.parse(date))) {
      return { error: "Invalid date" }
    }

    try {
      const data = await Effect.runPromise(getDailyCollections(date))
      return { data }
    } catch {
      return { error: "Internal server error" }
    }
  },
})

export const getLoansDueTodayAction = withAction({
  permission: "loan:read",
  effect: () => getLoansDueToday(),
})
