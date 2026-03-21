"use server"

import { Effect } from "effect"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "@/services/notification.service"

export async function getNotificationsAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const data = await Effect.runPromise(getNotifications(session.user.id))
    return { data }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function getUnreadCountAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    const count = await Effect.runPromise(getUnreadCount(session.user.id))
    return { data: count }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function markAsReadAction(notificationId: string) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    await Effect.runPromise(markAsRead(notificationId, session.user.id))
    return { data: true }
  } catch {
    return { error: "Internal server error" }
  }
}

export async function markAllAsReadAction() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: "Unauthorized" }

  try {
    await Effect.runPromise(markAllAsRead(session.user.id))
    return { data: true }
  } catch {
    return { error: "Internal server error" }
  }
}
