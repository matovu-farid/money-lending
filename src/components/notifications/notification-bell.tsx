"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  getNotificationsAction,
  markAsReadAction,
  markAllAsReadAction,
} from "@/actions/notification.actions"
import { useNotificationUnreadCount } from "@/hooks/use-notifications"
import { queryKeys } from "@/hooks/query-keys"
import type { Notification } from "@/types"
import { cn, formatRelativeTime } from "@/lib/utils"

export function NotificationBell() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  // Fetch unread count with polling every 60s
  const { data: unreadCount = 0 } = useNotificationUnreadCount()

  // Fetch full notification list when popover opens (lazy load via enabled)
  const { data: notifications = [], isLoading: loadingNotifications } = useQuery<Notification[]>({
    queryKey: [...queryKeys.notifications.all, "list"],
    queryFn: async () => {
      const result = await getNotificationsAction()
      if ("data" in result) return result.data ?? []
      return []
    },
    enabled: open,
    staleTime: 0,
  })

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) {
      queryClient.invalidateQueries({ queryKey: [...queryKeys.notifications.all, "list"] })
    }
  }

  const notificationsListKey = [...queryKeys.notifications.all, "list"]

  async function handleMarkAsRead(notification: Notification) {
    if (notification.isRead) return

    const result = await markAsReadAction(notification.id)
    if ("data" in result) {
      queryClient.setQueryData<Notification[]>(notificationsListKey, (prev) =>
        prev?.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
      )
      queryClient.setQueryData(
        queryKeys.notifications.unreadCount(),
        (prev: number) => Math.max(0, (prev ?? 0) - 1)
      )

      // Navigate to the relevant detail page based on reference type
      if (notification.referenceType === "loan" && notification.referenceId) {
        router.push(`/loans/${notification.referenceId}`)
      }
      // Chat is now a floating widget — no navigation needed for conversation notifications
      setOpen(false)
    }
  }

  async function handleMarkAllAsRead() {
    const result = await markAllAsReadAction()
    if ("data" in result) {
      queryClient.setQueryData<Notification[]>(notificationsListKey, (prev) =>
        prev?.map((n) => ({ ...n, isRead: true }))
      )
      queryClient.setQueryData(queryKeys.notifications.unreadCount(), 0)
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
          {loadingNotifications && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          )}

          {!loadingNotifications && notifications.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No alerts at this time.
            </div>
          )}

          {!loadingNotifications &&
            notifications.map((notification) => (
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
