"use client"

import { createCollection } from "@tanstack/react-db"
import { queryCollectionOptions } from "@/lib/collection-options"
import { getUnreadCountAction, getNotificationsAction, markAsReadAction } from "@/actions/notification.actions"
import type { Notification } from "@/types"
import { getQueryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

// --- Unread count (singleton) ---

export type UnreadCountRow = { _key: string; count: number }

export const notificationUnreadCountCollection = createCollection(
  queryCollectionOptions<UnreadCountRow>({
    queryKey: [...queryKeys.notifications.unreadCount],
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
    queryKey: [...queryKeys.notifications.list],
    queryClient: getQueryClient(),
    queryFn: async (_ctx): Promise<Array<NotificationRow>> => {
      const result = await getNotificationsAction()
      if ("data" in result) return (result.data ?? []) as NotificationRow[]
      return []
    },
    getKey: (row) => row.id,
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      if (changes.isRead === true) {
        const result = await markAsReadAction(original.id)
        if (!("data" in result)) throw new Error("Failed to mark as read")
      }
    },
  })
)
