import type { StateCreator } from 'zustand'
import type { SourceVideo, Clip } from '../../types'
import type { AppState, VideoSlice } from '../types'
import { basename, dirOf, stripExt } from '../../utils/media'
import { ordered, videoOffset } from '../../utils/timeline'
import { platform } from '../../core/ports'

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
    report: '',
    reportAt: null,
    checkedIds: [],
    activeTags: [],
    showCheckedOnly: false,
    videoTags: []
  }
}

async function probeToSource(path: string, order: number): Promise<SourceVideo> {
  const p = platform()
  const { duration, fps } = await p.probeVideo(path)
  return {
    id: crypto.randomUUID(),
    path,
    fileName: p.displayName(path),
    url: p.resolveUrl(path),
    duration,
    fps,
    order
  }
}

/** 读取某视频的片段数据（桌面=旁边的 sidecar），得到片段 + 该视频携带的标签词表 */
async function loadSidecar(video: SourceVideo): Promise<{ clips: Clip[]; tags: string[] }> {
  const raw = (await platform().loadData(platform().clipsKeyFor(video.path))) as {
    clips?: Array<{ id?: string; in: number; out: number; title?: string; order?: number; created_at?: string; tags?: string[] }>
    video_tags?: string[]
  } | null
  if (!raw || !Array.isArray(raw.clips)) return { clips: [], tags: raw?.video_tags || [] }
  const iso = new Date().toISOString()
  const clips = raw.clips
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c) => ({
      id: c.id || crypto.randomUUID(),
      videoId: video.id,
      in: c.in,
      out: c.out,
      title: c.title || '',
      order: 0,
      created_at: c.created_at || iso,
      tags: c.tags || []
    }))
  return { clips, tags: raw.video_tags || [] }
}

export const createVideoSlice: StateCreator<AppState, [], [], VideoSlice> = (set, get) => {
  // 给当前所有视频载入各自 sidecar 的片段，合并进内存
  const loadAllSidecars = async (): Promise<void> => {
    const vids = ordered(get().videos)
    const results = await Promise.all(vids.map(loadSidecar))
    const clips: Clip[] = []
    const tagSet = new Set(get().videoTags)
    results.forEach((r) => {
      r.clips.forEach((c) => clips.push({ ...c, order: clips.length }))
      r.tags.forEach((t) => tagSet.add(t))
    })
    set({ clips, videoTags: Array.from(tagSet) })
  }

  return {
    videos: [],
    activeVideoId: null,
    timelineName: '',
    timelinePath: null,

    addVideosFromPaths: async (paths) => {
      if (paths.length === 0) return
      const cur = get().videos
      const added = await Promise.all(paths.map((p, i) => probeToSource(p, cur.length + i)))
      const sidecars = await Promise.all(added.map(loadSidecar))
      const videos = [...cur, ...added]
      const newClips: Clip[] = []
      const tagSet = new Set(get().videoTags)
      sidecars.forEach((r) => {
        r.clips.forEach((c) => newClips.push(c))
        r.tags.forEach((t) => tagSet.add(t))
      })
      const clips = [...get().clips, ...newClips].map((c, i) => ({ ...c, order: i }))
      const patch: Partial<AppState> = { videos, clips, videoTags: Array.from(tagSet) }
      if (get().activeVideoId == null && added[0]) {
        patch.activeVideoId = added[0].id
        patch.pendingSeekLocal = 0
        patch.currentTime = 0
      }
      if (cur.length === 0 && added[0]) {
        // 时间线按"视频"建，避免同目录多场比赛互相串（<视频名>.kkclip）
        const dir = dirOf(added[0].path)
        const base = stripExt(added[0].fileName)
        patch.timelineName = base
        patch.timelinePath = dir + '/' + base + '.kkclip'
        patch.projectLoaded = true
        if (tagSet.size === 0) patch.videoTags = [...get().defaultTags]
        void platform().addRecent(patch.timelinePath)
        void platform().setSettings({ last_timeline: patch.timelinePath }) // #109
      }
      set(patch)
    },

    chooseAndAddVideos: async () => {
      const paths = await platform().pickVideos()
      await get().addVideosFromPaths(paths)
    },

    // 从时间线移除视频：只动"摆放"，片段仍随该视频保存在 sidecar，重新添加即恢复（#96）
    removeVideo: (id) =>
      set((s) => {
        const videos = ordered(s.videos.filter((v) => v.id !== id)).map((v, i) => ({ ...v, order: i }))
        const clips = s.clips.filter((c) => c.videoId !== id).map((c, i) => ({ ...c, order: i }))
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
      set({ activeVideoId: id, pendingSeekLocal: local, currentTime: videoOffset(get().videos, id) + local })
    },

    openVideoPath: async (path) => {
      if (path.endsWith('.kkclip')) {
        const raw = await platform().loadData(path)
        set(resetState())
        get().hydrateProject(raw, stripExt(basename(path)))
        set({ timelinePath: path })
        void platform().addRecent(path)
        void platform().setSettings({ last_timeline: path }) // #109
        // 旧格式内嵌了 clips（hydrate 已迁移）→ 不再覆盖；否则从各 sidecar 载入
        if (get().clips.length === 0) await loadAllSidecars()
        return
      }
      const dir = dirOf(path)
      const base = stripExt(basename(path))
      // 1) 该视频自己的时间线
      const videoKk = dir + '/' + base + '.kkclip'
      if (await platform().dataExists(videoKk)) {
        await get().openVideoPath(videoKk)
        return
      }
      // 2) 兼容旧的"文件夹时间线"：仅当它确实包含这个视频时才用它
      const folderKk = dir + '/' + (basename(dir) || base) + '.kkclip'
      if (folderKk !== videoKk && (await platform().dataExists(folderKk))) {
        const raw = (await platform().loadData(folderKk)) as { videos?: Array<{ path: string }> } | null
        if (raw && Array.isArray(raw.videos) && raw.videos.some((v) => v.path === path)) {
          await get().openVideoPath(folderKk)
          return
        }
      }
      // 3) 新建"按视频"的时间线（addVideosFromPaths 会自动载入该视频 sidecar 的片段）
      set(resetState())
      await get().addVideosFromPaths([path])
    },

    closeVideo: () => {
      get().pause()
      set(resetState())
      void platform().setSettings({ last_timeline: '' }) // #109：显式关闭后不再自动恢复
    }
  }
}
