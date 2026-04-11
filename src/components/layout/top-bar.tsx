"use client"

import { PanelLeft } from "lucide-react"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { useSidebarStore } from "@/lib/stores/sidebar"

export function TopBar() {
  const { collapsed, toggle } = useSidebarStore()

  return (
    <header className="h-14 bg-background flex items-center px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-3 flex-1">
        {collapsed ? (
          <button
            onClick={toggle}
            className="hidden md:flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Expand sidebar"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
        ) : (
          <button
            onClick={toggle}
            className="hidden md:inline font-semibold text-lg tracking-tight hover:text-muted-foreground transition-colors cursor-pointer"
            aria-label="Collapse sidebar"
          >
            Lending Manager
          </button>
        )}
        <span className="md:hidden font-semibold text-lg tracking-tight">Lending Manager</span>
      </div>
      <div className="flex items-center gap-2">
        <NotificationBell />
      </div>
    </header>
  )
}
