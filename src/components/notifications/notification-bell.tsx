"use client"

import { Suspense, useState } from "react"
import { useRouter } from "next/navigation"
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { Bell } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { markAllAsReadAction } from "@/actions/notification.actions"
import { useNotificationUnreadCount } from "@/hooks/use-notifications"
import { notificationListCollection, notificationUnreadCountCollection } from "@/collections"
import type { Notification } from "@/types"
import { cn, formatRelativeTime } from "@/lib/utils"

function NotificationBellSkeleton() {
  return (
    <Button variant="ghost" size="icon" className="relative" disabled>
      <Bell className="h-5 w-5" />
    </Button>
  )
}

export function NotificationBell() {
  return (
    <Suspense fallback={<NotificationBellSkeleton />}>
      <NotificationBellContent />
    </Suspense>
  )
}

function NotificationBellContent() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // Fetch unread count from collection
  const { data: unreadCount = 0 } = useNotificationUnreadCount()

  // Fetch full notification list from collection
  const { data: notificationRows } = useLiveSuspenseQuery((q) =>
    q.from({ n: notificationListCollection }).select(({ n }) => n)
  )
  const notifications: Notification[] = (notificationRows ?? []) as Notification[]

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
  }

  async function handleMarkAsRead(notification: Notification) {
    if (notification.isRead) return

    // Optimistic update via collection
    notificationListCollection.update(notification.id, (draft) => {
      draft.isRead = true
    })
    notificationUnreadCountCollection.update("singleton", (draft) => {
      draft.count = Math.max(0, draft.count - 1)
    })

    // Navigate to the relevant detail page based on reference type
    if (notification.referenceType === "loan" && notification.referenceId) {
      router.push(`/loans/${notification.referenceId}`)
    }
    setOpen(false)
  }

  async function handleMarkAllAsRead() {
    // Mark all as read on server
    const result = await markAllAsReadAction()
    if ("data" in result) {
      // Update each notification in the collection
      notifications.forEach((n) => {
        if (!n.isRead) {
          notificationListCollection.update(n.id, (draft) => {
            draft.isRead = true
          })
        }
      })
      notificationUnreadCountCollection.update("singleton", (draft) => {
        draft.count = 0
      })
    }
  }

  const displayCount = unreadCount > 9 ? "9+" : unreadCount

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            className="relative min-h-[44px] min-w-[44px]"
          />
        }
      >
        <Bell
          className={cn(
            "h-5 w-5",
            unreadCount > 0 ? "text-foreground" : "text-muted-foreground"
          )}
        />
        {unreadCount > 0 && (
          <Badge variant="destructive" className="absolute -top-1 -right-1 rounded-full h-5 w-5 justify-center px-0 bg-red-600 text-white">
            {displayCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">Notifications</span>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="text-xs text-primary hover:underline"
            >
              Mark all as read
            </button>
          )}
        </div>

        {/* Notification list */}
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No alerts at this time.
            </div>
          )}

          {notifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => handleMarkAsRead(notification)}
                className={cn(
                  "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors border-b last:border-b-0",
                  !notification.isRead
                    ? "border-l-2 border-primary pl-3"
                    : "text-muted-foreground"
                )}
              >
                <p
                  className={cn(
                    "text-sm",
                    !notification.isRead ? "font-medium" : "text-muted-foreground"
                  )}
                >
                  {notification.message}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatRelativeTime(notification.createdAt)}
                </p>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
