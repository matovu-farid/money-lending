import { create } from 'zustand'

// Add client-side state slices here as needed
interface AppState {
  // placeholder — add state properties here
}

export const useAppStore = create<AppState>(() => ({
  // initial state
}))
