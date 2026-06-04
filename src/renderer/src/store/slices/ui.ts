import type { StateCreator } from 'zustand'
import { DEFAULT_KEYBINDINGS } from '../../types'
import type { AppState, UiSlice } from '../types'

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  keybindings: DEFAULT_KEYBINDINGS,
  isFullscreen: false,
  subtitleOn: false,
  settingsOpen: false,
  exportOpen: false,
  mergeOpen: false,
  reportOpen: false,

  setKeybindings: (kb) => set({ keybindings: kb }),
  setIsFullscreen: (v) => set({ isFullscreen: v }),
  toggleSubtitle: () => set((s) => ({ subtitleOn: !s.subtitleOn })),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openExport: () => set({ exportOpen: true }),
  closeExport: () => set({ exportOpen: false }),
  openMerge: () => set({ mergeOpen: true }),
  closeMerge: () => set({ mergeOpen: false }),
  openReport: () => set({ reportOpen: true }),
  closeReport: () => set({ reportOpen: false })
})
