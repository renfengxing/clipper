import type { StateCreator } from 'zustand'
import type { AppState, ProjectSlice } from '../types'

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => ({
  titleTemplate: '',
  projectCreatedAt: null,
  savedAt: null,
  projectLoaded: false,
  exportHistory: {},
  lastExportDir: null,

  setExportHistory: (h) => set({ exportHistory: h }),
  setLastExportDir: (dir) => set({ lastExportDir: dir }),
  setTitleTemplate: (t) => set({ titleTemplate: t }),
  setSavedAt: (iso) => set({ savedAt: iso }),

  hydrateProject: (data) => {
    if (data) {
      const clips = [...data.clips].sort((a, b) => a.order - b.order).map((c, i) => ({ ...c, order: i }))
      set({
        clips,
        projectCreatedAt: data.created_at,
        titleTemplate: data.title_template || get().titleTemplate,
        exportHistory: data.exports || {},
        lastExportDir: data.last_export_dir ?? null,
        // 视频标签：项目里有就用，否则用系统默认标签起步（#57）
        videoTags: data.video_tags ?? [...get().defaultTags],
        projectLoaded: true
      })
    } else {
      set({ videoTags: [...get().defaultTags], projectLoaded: true })
    }
  }
})
