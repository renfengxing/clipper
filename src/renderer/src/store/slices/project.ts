import type { StateCreator } from 'zustand'
import type { AppState, ProjectSlice } from '../types'
import { toMediaUrl } from '../../utils/media'
import { ordered } from '../../utils/timeline'

interface RawTimeline {
  name?: string
  created_at?: string
  title_template?: string
  videos?: Array<{ path: string; fileName: string; duration: number; fps: number; order: number }>
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

  // 时间线只含视频摆放顺序；片段由 video 切片从各 sidecar 载入（#96）。video.id 每次会话新生成。
  hydrateProject: (raw, fallbackName) => {
    const data = raw as RawTimeline | null
    if (data && Array.isArray(data.videos)) {
      const videos = ordered(
        data.videos.map((v) => ({ ...v, id: crypto.randomUUID(), url: toMediaUrl(v.path) }))
      ).map((v, i) => ({ ...v, order: i }))
      set({
        videos,
        activeVideoId: videos[0]?.id ?? null,
        pendingSeekLocal: videos[0] ? 0 : null,
        currentTime: 0,
        clips: [],
        timelineName: data.name || fallbackName,
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
