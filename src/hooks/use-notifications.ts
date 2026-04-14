"use client"

import { useLiveQuery } from "@tanstack/react-db"
import { notificationUnreadCountCollection } from "@/collections"

export function useNotificationUnreadCount() {
  const { data } = useLiveQuery((q) =>
    q.from({ n: notificationUnreadCountCollection }).select(({ n }) => n)
  )
  const count = data?.[0]?.count ?? 0
  return { data: count }
}
