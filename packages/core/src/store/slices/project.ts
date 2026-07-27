import type { StateCreator } from 'zustand'
import type { Clip } from '../../types'
import type { AppState, ProjectSlice } from '../types'
import { platform } from '../../ports'
import { ordered } from '../../utils/timeline'

interface RawTimeline {
  name?: string
  created_at?: string
  title_template?: string
  videos?: Array<{ id?: string; path: string; fileName: string; duration: number; fps: number; order: number }>
  // 旧格式 .kkclip 可能内嵌了 clips（含 tags），迁移时要保留
  clips?: Array<{ id?: string; videoId?: string; in: number; out: number; title?: string; order?: number; created_at?: string; tags?: string[] }>
  video_tags?: string[]
  exports?: Record<string, string>
  last_export_dir?: string | null
  report?: string
  report_at?: string | null
}

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => ({
  titleTemplate: '',
  projectCreatedAt: null,
  savedAt: null,
  projectLoaded: false,
  exportHistory: {},
  lastExportDir: null,
  report: '',
  reportAt: null,

  setExportHistory: (h) => set({ exportHistory: h }),
  setLastExportDir: (dir) => set({ lastExportDir: dir }),
  setTitleTemplate: (t) => set({ titleTemplate: t }),
  setSavedAt: (iso) => set({ savedAt: iso }),
  setReport: (text) => set({ report: text, reportAt: new Date().toISOString() }),

  // 时间线只含视频摆放顺序；片段由 video 切片从各 sidecar 载入（#96）。video.id 每次会话新生成。
  hydrateProject: (raw, fallbackName) => {
    const data = raw as RawTimeline | null
    if (data && Array.isArray(data.videos)) {
      // 复用旧格式里存的 video.id（便于内嵌 clips 的 videoId 对上）
      const videos = ordered(
        data.videos.map((v) => ({ ...v, id: v.id || crypto.randomUUID(), url: platform().resolveUrl(v.path) }))
      ).map((v, i) => ({ ...v, order: i }))
      const ids = new Set(videos.map((v) => v.id))
      const iso = new Date().toISOString()
      // 旧格式 .kkclip 内嵌 clips（含 tags）→ 迁移进来，避免丢标签（#96 兼容）
      const embedded: Clip[] = Array.isArray(data.clips)
        ? data.clips.map((c, i) => ({
            id: c.id || crypto.randomUUID(),
            videoId: c.videoId && ids.has(c.videoId) ? c.videoId : videos[0]?.id || '',
            in: c.in,
            out: c.out,
            title: c.title || '',
            order: i,
            created_at: c.created_at || iso,
            tags: c.tags || []
          }))
        : []
      set({
        videos,
        activeVideoId: videos[0]?.id ?? null,
        pendingSeekLocal: videos[0] ? 0 : null,
        currentTime: 0,
        clips: embedded,
        timelineName: data.name || fallbackName,
        projectCreatedAt: data.created_at || new Date().toISOString(),
        titleTemplate: data.title_template || get().titleTemplate,
        exportHistory: data.exports || {},
        lastExportDir: data.last_export_dir ?? null,
        videoTags: data.video_tags ?? [...get().defaultTags],
        report: data.report || '',
        reportAt: data.report_at ?? null,
        projectLoaded: true
      })
    } else {
      set({ projectLoaded: true })
    }
  }
})
