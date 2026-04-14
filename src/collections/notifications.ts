"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { getUnreadCountAction, getNotificationsAction } from "@/actions/notification.actions"
import type { Notification } from "@/types"
import { getQueryClient } from "@/lib/query-client"

// --- Unread count (singleton) ---

export type UnreadCountRow = { _key: string; count: number }

export const notificationUnreadCountCollection = createCollection(
  queryCollectionOptions<UnreadCountRow>({
    queryKey: ["notifications", "unread-count"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<UnreadCountRow>> => {
      const result = await getUnreadCountAction()
      const count = "data" in result ? (result.data ?? 0) : 0
      return [{ _key: "singleton", count }]
    },
    getKey: (row) => row._key,
  })
)

// --- Notification list ---

export type NotificationRow = Notification

export const notificationListCollection = createCollection(
  queryCollectionOptions<NotificationRow>({
    queryKey: ["notifications", "list"],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<NotificationRow>> => {
      const result = await getNotificationsAction()
      if ("data" in result) return (result.data ?? []) as NotificationRow[]
      return []
    },
    getKey: (row) => row.id,
  })
)
