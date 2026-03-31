"use client"

import { useQuery } from "@tanstack/react-query"
import { getUnreadCountAction } from "@/actions/notification.actions"
import { queryKeys } from "./query-keys"

export function useNotificationUnreadCount() {
  return useQuery<number>({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: async () => {
      const result = await getUnreadCountAction()
      if ("data" in result) return result.data ?? 0
      return 0
    },
    refetchInterval: 60000,
  })
}
