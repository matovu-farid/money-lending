"use client"

import { useState } from "react"
import { TopBar } from "@/components/layout/top-bar"
import { Sidebar } from "@/components/layout/sidebar"
import { BottomTabBar } from "@/components/layout/bottom-tab-bar"
import { MoreSheet } from "@/components/layout/more-sheet"

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <div className="flex flex-col h-screen">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        <main className="flex-1 overflow-auto bg-background p-4 md:p-6 main-content-pb md:pb-6">
          {children}
        </main>
      </div>

      <BottomTabBar
        className="flex md:hidden"
        onMoreClick={() => setMoreOpen(true)}
      />
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </div>
  )
}
