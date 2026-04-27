"use client"

import { PanelLeft, Search } from "lucide-react"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { useSidebarStore } from "@/lib/stores/sidebar"
import { useCommandPalette } from "@/components/command-palette"
import { LogoMark } from "@/components/brand/logo"

export function TopBar() {
  const { collapsed, toggle } = useSidebarStore()
  const { open: openCommandPalette } = useCommandPalette()

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
            className="hidden md:inline-flex items-center gap-2 font-semibold text-lg tracking-tight hover:text-muted-foreground transition-colors cursor-pointer"
            aria-label="Collapse sidebar"
          >
            <LogoMark size={26} />
            Lending Manager
          </button>
        )}
        <span className="md:hidden inline-flex items-center gap-2 font-semibold text-lg tracking-tight">
          <LogoMark size={24} />
          Lending Manager
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={openCommandPalette}
          className="hidden sm:flex items-center gap-2 h-8 rounded-md border border-border bg-muted/50 px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="Open command palette"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs">Search...</span>
          <kbd className="ml-1 inline-flex h-5 items-center gap-0.5 rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium">
            <span className="text-xs">&#8984;</span>K
          </kbd>
        </button>
        <button
          onClick={openCommandPalette}
          className="flex sm:hidden items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="Open command palette"
        >
          <Search className="h-4 w-4" />
        </button>
        <ThemeToggle />
      </div>
    </header>
  )
}
