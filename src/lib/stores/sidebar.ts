import { create } from "zustand"
import { devtools, persist } from "zustand/middleware"

interface SidebarState {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (v: boolean) => void
}

export const useSidebarStore = create<SidebarState>()(
  devtools(
    persist(
      (set) => ({
        collapsed: false,
        toggle: () => set((s) => ({ collapsed: !s.collapsed })),
        setCollapsed: (v) => set({ collapsed: v }),
      }),
      { name: "sidebar-collapsed" }
    ),
    { name: "sidebar" }
  )
)
