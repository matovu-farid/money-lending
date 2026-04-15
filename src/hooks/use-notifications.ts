"use client"

import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { notificationUnreadCountCollection } from "@/collections"

export function useNotificationUnreadCount() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ n: notificationUnreadCountCollection }).select(({ n }) => n)
  )
  const count = data?.[0]?.count ?? 0
  return { data: count }
}
