import type { StateCreator } from 'zustand'
import type { SourceVideo } from '../../types'
import type { AppState, VideoSlice } from '../types'
import { toMediaUrl, basename, dirOf, stripExt } from '../../utils/media'
import { ordered, videoOffset } from '../../utils/timeline'

/** 打开/关闭时间线时重置的跨切片状态 */
function resetState(): Partial<AppState> {
  return {
    videos: [],
    activeVideoId: null,
    timelineName: '',
    timelinePath: null,
    clips: [],
    currentTime: 0,
    playing: false,
    rate: 1,
    direction: 'paused',
    previewEnd: null,
    pendingSeekLocal: null,
    markIn: null,
    markOut: null,
    titleModalOpen: false,
    resumeAfterModal: false,
    selectedClipId: null,
    projectCreatedAt: null,
    savedAt: null,
    projectLoaded: false,
    exportHistory: {},
    lastExportDir: null,
    checkedIds: [],
    activeTags: [],
    showCheckedOnly: false,
    videoTags: []
  }
}

async function probeToSource(path: string, order: number): Promise<SourceVideo> {
  const { duration, fps } = await window.api.probeVideo(path)
  return {
    id: crypto.randomUUID(),
    path,
    fileName: basename(path),
    url: toMediaUrl(path),
    duration,
    fps,
    order
  }
}

export const createVideoSlice: StateCreator<AppState, [], [], VideoSlice> = (set, get) => ({
  videos: [],
  activeVideoId: null,
  timelineName: '',
  timelinePath: null,

  addVideosFromPaths: async (paths) => {
    if (paths.length === 0) return
    const cur = get().videos
    const added = await Promise.all(paths.map((p, i) => probeToSource(p, cur.length + i)))
    const videos = [...cur, ...added]
    const patch: Partial<AppState> = { videos }
    if (get().activeVideoId == null && added[0]) {
      patch.activeVideoId = added[0].id
      patch.pendingSeekLocal = 0
      patch.currentTime = 0
    }
    if (cur.length === 0 && added[0]) {
      const dir = dirOf(added[0].path)
      const folderName = basename(dir) || stripExt(added[0].fileName)
      patch.timelineName = folderName
      patch.timelinePath = dir + '/' + folderName + '.kkclip'
      patch.projectLoaded = true
      if (get().videoTags.length === 0) patch.videoTags = [...get().defaultTags]
      void window.api.addRecentFile(patch.timelinePath)
    }
    set(patch)
  },

  chooseAndAddVideos: async () => {
    const paths = await window.api.chooseVideos()
    await get().addVideosFromPaths(paths)
  },

  removeVideo: (id) =>
    set((s) => {
      const videos = ordered(s.videos.filter((v) => v.id !== id)).map((v, i) => ({ ...v, order: i }))
      const clips = s.clips.filter((c) => c.videoId !== id)
      const activeVideoId = s.activeVideoId === id ? (videos[0]?.id ?? null) : s.activeVideoId
      return {
        videos,
        clips,
        activeVideoId,
        currentTime: 0,
        pendingSeekLocal: activeVideoId ? 0 : null,
        playing: false,
        selectedClipId: s.selectedClipId && clips.some((c) => c.id === s.selectedClipId) ? s.selectedClipId : null
      }
    }),

  reorderVideos: (from, to) =>
    set((s) => {
      const list = ordered(s.videos)
      if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return {}
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      return { videos: list.map((v, i) => ({ ...v, order: i })) }
    }),

  setActiveVideo: (id, local) => {
    const v = get().videos.find((x) => x.id === id)
    if (!v) return
    set({
      activeVideoId: id,
      pendingSeekLocal: local,
      currentTime: videoOffset(get().videos, id) + local
    })
  },

  openVideoPath: async (path) => {
    // 从旧 .kkfb.json 把片段迁移到当前单视频时间线
    const importLegacy = async (legacyPath: string): Promise<void> => {
      const legacy = (await window.api.loadProject(legacyPath)) as {
        clips?: Array<{ id?: string; in: number; out: number; title?: string; created_at?: string; tags?: string[] }>
        video_tags?: string[]
        title_template?: string
      } | null
      const vid = get().videos[0]?.id
      if (legacy && Array.isArray(legacy.clips) && legacy.clips.length > 0 && vid) {
        const iso = new Date().toISOString()
        const clips = legacy.clips.map((c, i) => ({
          id: c.id || crypto.randomUUID(),
          videoId: vid,
          in: c.in,
          out: c.out,
          title: c.title || '',
          order: i,
          created_at: c.created_at || iso,
          tags: c.tags || []
        }))
        set({
          clips,
          videoTags: legacy.video_tags && legacy.video_tags.length ? legacy.video_tags : get().videoTags,
          titleTemplate: legacy.title_template ?? get().titleTemplate
        })
      }
    }

    if (path.endsWith('.kkclip')) {
      const raw = await window.api.loadProject(path)
      set(resetState())
      get().hydrateProject(raw, stripExt(basename(path)))
      set({ timelinePath: path })
      void window.api.addRecentFile(path)
      return
    }

    const dir = dirOf(path)
    const folderName = basename(dir) || stripExt(basename(path))
    const kkclip = dir + '/' + folderName + '.kkclip'
    const legacyPath = path + '.kkfb.json'

    if (await window.api.fileExists(kkclip)) {
      const raw = await window.api.loadProject(kkclip)
      set(resetState())
      get().hydrateProject(raw, folderName)
      set({ timelinePath: kkclip })
      void window.api.addRecentFile(kkclip)
      // 补迁移：已有 .kkclip 但里面没片段，而旧 .kkfb.json 有 → 不丢老数据（#94）
      if (get().clips.length === 0 && (await window.api.fileExists(legacyPath))) {
        await importLegacy(legacyPath)
      }
      return
    }

    // 全新单视频时间线
    set(resetState())
    await get().addVideosFromPaths([path])
    if (await window.api.fileExists(legacyPath)) await importLegacy(legacyPath)
  },

  closeVideo: () => {
    get().pause()
    set(resetState())
  }
})
