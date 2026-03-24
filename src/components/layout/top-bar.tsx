import { NotificationBell } from "@/components/notifications/notification-bell"

export function TopBar() {
  return (
    <header className="h-14 bg-background flex items-center px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-3 flex-1">
        <span className="font-semibold text-lg tracking-tight">Lending Manager</span>
      </div>
      <div className="flex items-center gap-2">
        <NotificationBell />
      </div>
    </header>
  )
}
