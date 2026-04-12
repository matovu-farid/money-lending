"use server"

import { withAction } from "@/lib/with-action"
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "@/services/notification.service"

export const getNotificationsAction = withAction({
  effect: (session) => getNotifications(session.user.id),
})

export const getUnreadCountAction = withAction({
  effect: (session) => getUnreadCount(session.user.id),
})

export const markAsReadAction = withAction<string, any>({
  effect: (session, notificationId) => markAsRead(notificationId, session.user.id),
})

export const markAllAsReadAction = withAction({
  effect: (session) => markAllAsRead(session.user.id),
})
