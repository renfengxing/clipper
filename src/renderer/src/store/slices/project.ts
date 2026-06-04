import type { StateCreator } from 'zustand'
import type { SourceVideo, Clip } from '../../types'
import type { AppState, ProjectSlice } from '../types'
import { toMediaUrl } from '../../utils/media'
import { ordered } from '../../utils/timeline'

interface RawV2 {
  name?: string
  created_at?: string
  title_template?: string
  videos?: Array<Omit<SourceVideo, 'url'>>
  clips?: Clip[]
  video_tags?: string[]
  exports?: Record<string, string>
  last_export_dir?: string | null
}

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

  hydrateProject: (raw, fallbackName) => {
    const data = raw as RawV2 | null
    if (data && Array.isArray(data.videos)) {
      const videos = ordered(data.videos.map((v) => ({ ...v, url: toMediaUrl(v.path) }))).map(
        (v, i) => ({ ...v, order: i })
      )
      const clips = [...(data.clips || [])]
        .sort((a, b) => a.order - b.order)
        .map((c, i) => ({ ...c, order: i, tags: c.tags || [] }))
      set({
        videos,
        activeVideoId: videos[0]?.id ?? null,
        pendingSeekLocal: videos[0] ? 0 : null,
        currentTime: 0,
        timelineName: data.name || fallbackName,
        clips,
        projectCreatedAt: data.created_at || new Date().toISOString(),
        titleTemplate: data.title_template || get().titleTemplate,
        exportHistory: data.exports || {},
        lastExportDir: data.last_export_dir ?? null,
        videoTags: data.video_tags ?? [...get().defaultTags],
        projectLoaded: true
      })
    } else {
      set({ projectLoaded: true })
    }
  }
})
