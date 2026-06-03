import { create } from 'zustand'
import { DEFAULT_KEYBINDINGS } from '../types'
import type { Clip, VideoState, ProjectData, Keybindings } from '../types'

const FRAME = 1 / 30 // 单帧步进约 0.033s（规格 五）
// 三段式速率（#30）：快进/快退/控速各管一段，连按在段内步进
const FAST = [2, 4, 8] // L 快进（正放快放）
const REV = [2, 4] // J 快退（倒放，#68）
const SLOW = [1, 0.5, 0.25, 0.1] // K 控速（正放正常→慢放，循环）

export type Direction = 'forward' | 'reverse' | 'paused'

interface AppState {
  video: VideoState | null
  clips: Clip[]
  /** 播放头当前位置（秒） */
  currentTime: number
  /** 真实 <video> 元素，由 VideoPlayer 注册，供 transport / timeline 直接操作 */
  videoEl: HTMLVideoElement | null

  /** 传输状态 */
  playing: boolean
  rate: number
  direction: Direction

  /** 待保存片段的入/出点（秒），null 表示未标记 */
  markIn: number | null
  markOut: number | null
  /** 标题输入框是否打开 */
  titleModalOpen: boolean
  /** 打开标题框前是否在播放——关闭后据此决定是否自动续播 */
  resumeAfterModal: boolean
  /** 当前选中的片段 id（规格 6.2） */
  selectedClipId: string | null
  /** 预览片段时的停止点（秒）；null 表示未在预览 */
  previewEnd: number | null

  /** 项目持久化相关 */
  titleTemplate: string
  projectCreatedAt: string | null
  savedAt: string | null
  /** 是否已尝试加载项目文件（加载完成前不自动保存，避免覆盖） */
  projectLoaded: boolean
  /** 导出记录与上次目录（增量导出 + 记住目录） */
  exportHistory: Record<string, string>
  lastExportDir: string | null
  setExportHistory: (h: Record<string, string>) => void
  setLastExportDir: (dir: string) => void

  /** 可配置快捷键 */
  keybindings: Keybindings
  setKeybindings: (kb: Keybindings) => void

  /** 全屏状态（由主进程同步，#43） */
  isFullscreen: boolean
  setIsFullscreen: (v: boolean) => void

  /** 弹幕开关（#75）：把片段标题当弹幕播放 */
  danmakuOn: boolean
  toggleDanmaku: () => void

  /** 多选（合并用，#45）与标签（#46/#57） */
  checkedIds: string[]
  activeTags: string[] // 标签筛选（多选，#49）
  showCheckedOnly: boolean // 只看已选（#51）
  videoTags: string[] // 本视频标签列表（#57）
  defaultTags: string[] // 系统标签（来自设置）
  aiTagging: boolean
  toggleChecked: (id: string) => void
  setChecked: (ids: string[]) => void
  clearChecked: () => void
  toggleActiveTag: (tag: string) => void
  clearActiveTags: () => void
  setShowCheckedOnly: (v: boolean) => void
  setDefaultTags: (tags: string[]) => void
  addVideoTag: (tag: string) => void
  removeVideoTag: (tag: string) => void
  addTag: (id: string, tag: string) => void // 给片段打标签（自动并入 videoTags）
  removeTag: (id: string, tag: string) => void
  aiAutoTag: () => Promise<{ ok: boolean; error?: string; code?: string }> // #50

  /** 打开视频路径（含载入项目 + 记最近，#41） */
  openVideoPath: (path: string) => Promise<void>

  /** 弹窗开关 */
  settingsOpen: boolean
  exportOpen: boolean
  mergeOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  openExport: () => void
  closeExport: () => void
  openMerge: () => void
  closeMerge: () => void
  reportOpen: boolean
  openReport: () => void
  closeReport: () => void

  // —— 片段列表交互（阶段5）——
  selectClip: (id: string) => void // 点击：跳到入点并暂停在第一帧
  deselectClip: () => void
  updateClipTitle: (id: string, title: string) => void
  updateClipTimes: (id: string, inSec: number, outSec: number) => void // 阶段6：拖拽调整
  deleteClip: (id: string) => void
  reorderClips: (from: number, to: number) => void
  sortClipsByTime: () => void // 按入点时间排序（#36）

  // —— 持久化 ——
  setTitleTemplate: (t: string) => void
  setSavedAt: (iso: string) => void
  hydrateProject: (data: ProjectData | null) => void

  // —— 标记 / 片段 ——
  setMarkIn: () => void // I：在当前位置标入点
  setMarkOut: () => void // O：在当前位置标出点
  clearMarks: () => void // Esc：取消 I/O 标记
  openTitleModal: () => void // Enter：弹出标题框（需 I/O 都已标记）
  closeTitleModal: () => void
  addClip: (title: string, tags?: string[]) => void // 标题框确认：生成片段（可带标签）

  // —— 加载 ——
  loadVideo: (path: string) => void
  closeVideo: () => void // 关闭当前视频（#72）
  setDuration: (duration: number) => void
  setCurrentTime: (t: number) => void
  setVideoEl: (el: HTMLVideoElement | null) => void

  // —— 传输控制（被快捷键、控制条按钮、时间线共用）——
  seek: (t: number) => void
  play: () => void // 正常 1x 正放（重置）
  pause: () => void // 暂停，但保留当前速率/方向（#31）
  resume: () => void // 按当前速率/方向继续
  togglePlay: () => void
  speedUp: () => void // 快进：速率梯上移
  speedDown: () => void // 快退：速率梯下移
  resetSpeed: () => void // 重置正常速度（#20）
  stepFrame: (dir: 1 | -1) => void // ← →：单帧
  jump: (sec: number) => void // Shift+← →：跳 N 秒
}

function toMediaUrl(path: string): string {
  return 'media://local' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

/** 标题去重：已存在则自动加 _02 _03（空标题允许重复，代表未命名） */
function uniqueTitle(title: string, existing: string[]): string {
  if (!title) return ''
  const set = new Set(existing)
  if (!set.has(title)) return title
  let n = 2
  let cand = `${title}_${String(n).padStart(2, '0')}`
  while (set.has(cand)) {
    n++
    cand = `${title}_${String(n).padStart(2, '0')}`
  }
  return cand
}

export const useStore = create<AppState>((set, get) => {
  // 倒放用 rAF 手动回退 currentTime（Chromium 不支持负 playbackRate）
  let raf = 0
  let lastTs = 0

  const stopReverse = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    lastTs = 0
  }

  const reverseTick = (ts: number): void => {
    const { videoEl, rate } = get()
    if (!videoEl) return stopReverse()
    if (lastTs) {
      const dt = (ts - lastTs) / 1000
      const t = videoEl.currentTime - dt * rate
      if (t <= 0) {
        videoEl.currentTime = 0
        set({ currentTime: 0, playing: false, direction: 'paused', rate: 1 })
        return stopReverse()
      }
      videoEl.currentTime = t
      set({ currentTime: t })
    }
    lastTs = ts
    raf = requestAnimationFrame(reverseTick)
  }

  // 按带符号速率播放（v>0 正放，v<0 倒放，v=0 暂停）
  const applySigned = (v: number): void => {
    const { videoEl } = get()
    if (!videoEl) return
    if (v > 0) {
      stopReverse()
      videoEl.playbackRate = v
      void videoEl.play()
      set({ playing: true, direction: 'forward', rate: v })
    } else if (v < 0) {
      videoEl.pause()
      stopReverse()
      set({ playing: true, direction: 'reverse', rate: -v })
      raf = requestAnimationFrame(reverseTick)
    } else {
      get().pause()
    }
  }

  return {
    video: null,
    clips: [],
    currentTime: 0,
    videoEl: null,
    playing: false,
    rate: 1,
    direction: 'paused',
    markIn: null,
    markOut: null,
    titleModalOpen: false,
    resumeAfterModal: false,
    selectedClipId: null,
    previewEnd: null,
    titleTemplate: '',
    projectCreatedAt: null,
    savedAt: null,
    projectLoaded: false,
    exportHistory: {},
    lastExportDir: null,
    keybindings: DEFAULT_KEYBINDINGS,
    isFullscreen: false,
    danmakuOn: false,
    checkedIds: [],
    activeTags: [],
    showCheckedOnly: false,
    videoTags: [],
    defaultTags: [],
    aiTagging: false,
    settingsOpen: false,
    exportOpen: false,
    mergeOpen: false,
    reportOpen: false,

    setKeybindings: (kb) => set({ keybindings: kb }),
    setIsFullscreen: (v) => set({ isFullscreen: v }),
    toggleDanmaku: () => set((s) => ({ danmakuOn: !s.danmakuOn })),
    setExportHistory: (h) => set({ exportHistory: h }),
    setLastExportDir: (dir) => set({ lastExportDir: dir }),

    toggleChecked: (id) =>
      set((s) => ({
        checkedIds: s.checkedIds.includes(id)
          ? s.checkedIds.filter((x) => x !== id)
          : [...s.checkedIds, id]
      })),
    setChecked: (ids) => set({ checkedIds: ids }),
    clearChecked: () => set({ checkedIds: [] }),
    toggleActiveTag: (tag) =>
      set((s) => ({
        activeTags: s.activeTags.includes(tag)
          ? s.activeTags.filter((x) => x !== tag)
          : [...s.activeTags, tag]
      })),
    clearActiveTags: () => set({ activeTags: [] }),
    setShowCheckedOnly: (v) => set({ showCheckedOnly: v }),
    setDefaultTags: (tags) => set({ defaultTags: tags }),

    addVideoTag: (tag) =>
      set((s) => {
        const t = tag.trim().slice(0, 15)
        if (!t || s.videoTags.includes(t)) return {}
        return { videoTags: [...s.videoTags, t] }
      }),
    removeVideoTag: (tag) =>
      set((s) => ({
        videoTags: s.videoTags.filter((x) => x !== tag),
        activeTags: s.activeTags.filter((x) => x !== tag),
        // 同时从所有片段移除该标签
        clips: s.clips.map((c) => ({ ...c, tags: (c.tags || []).filter((x) => x !== tag) }))
      })),

    addTag: (id, tag) =>
      set((s) => {
        const t = tag.trim().slice(0, 15)
        if (!t) return {}
        return {
          videoTags: s.videoTags.includes(t) ? s.videoTags : [...s.videoTags, t],
          clips: s.clips.map((c) =>
            c.id === id && !(c.tags || []).includes(t)
              ? { ...c, tags: [...(c.tags || []), t] }
              : c
          )
        }
      }),
    removeTag: (id, tag) =>
      set((s) => ({
        clips: s.clips.map((c) =>
          c.id === id ? { ...c, tags: (c.tags || []).filter((x) => x !== tag) } : c
        )
      })),

    aiAutoTag: async () => {
      const { clips, videoTags } = get()
      if (clips.length === 0) return { ok: false, error: '没有片段' }
      set({ aiTagging: true })
      const res = await window.api.autoTag(
        clips.map((c) => ({ title: c.title })),
        videoTags
      )
      if (res.ok && res.tags) {
        const tagsByClip = res.tags
        const newVideoTags = new Set(get().videoTags)
        const clipsNow = get().clips.map((c, i) => {
          const incoming = (tagsByClip[i] || []).map((t) => t.trim().slice(0, 15)).filter(Boolean)
          incoming.forEach((t) => newVideoTags.add(t))
          const merged = Array.from(new Set([...(c.tags || []), ...incoming]))
          return { ...c, tags: merged }
        })
        set({ clips: clipsNow, videoTags: Array.from(newVideoTags), aiTagging: false })
        return { ok: true }
      }
      set({ aiTagging: false })
      return { ok: false, error: res.error, code: res.code }
    },

    openVideoPath: async (path) => {
      if (get().video?.path === path) return // 已打开则不重开（#47）
      get().loadVideo(path)
      void window.api.addRecentFile(path)
      const data = await window.api.loadProject(path)
      get().hydrateProject(data)
    },

    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),
    openExport: () => set({ exportOpen: true }),
    closeExport: () => set({ exportOpen: false }),
    openMerge: () => set({ mergeOpen: true }),
    closeMerge: () => set({ mergeOpen: false }),
    openReport: () => set({ reportOpen: true }),
    closeReport: () => set({ reportOpen: false }),

    loadVideo: (path) => {
      stopReverse()
      set({
        video: { path, fileName: basename(path), url: toMediaUrl(path), duration: 0 },
        clips: [],
        currentTime: 0,
        playing: false,
        rate: 1,
        direction: 'paused',
        markIn: null,
        markOut: null,
        titleModalOpen: false,
        resumeAfterModal: false,
        selectedClipId: null,
        previewEnd: null,
        projectCreatedAt: null,
        savedAt: null,
        projectLoaded: false,
        exportHistory: {},
        lastExportDir: null,
        checkedIds: [],
        activeTags: [],
        showCheckedOnly: false,
        videoTags: []
      })
    },

    closeVideo: () => {
      stopReverse()
      set({
        video: null,
        clips: [],
        currentTime: 0,
        playing: false,
        rate: 1,
        direction: 'paused',
        markIn: null,
        markOut: null,
        titleModalOpen: false,
        resumeAfterModal: false,
        selectedClipId: null,
        previewEnd: null,
        projectCreatedAt: null,
        savedAt: null,
        projectLoaded: false,
        exportHistory: {},
        lastExportDir: null,
        checkedIds: [],
        activeTags: [],
        showCheckedOnly: false,
        videoTags: []
      })
    },

    setTitleTemplate: (t) => set({ titleTemplate: t }),
    setSavedAt: (iso) => set({ savedAt: iso }),

    hydrateProject: (data) => {
      if (data) {
        const clips = [...data.clips]
          .sort((a, b) => a.order - b.order)
          .map((c, i) => ({ ...c, order: i }))
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
    },

    // 选中即从入点播放，且只播放片段内容（到出点自动暂停，#27）
    selectClip: (id) => {
      const { clips, videoEl } = get()
      const clip = clips.find((c) => c.id === id)
      if (!clip || !videoEl) return
      stopReverse()
      videoEl.currentTime = clip.in
      videoEl.playbackRate = 1
      void videoEl.play()
      set({
        selectedClipId: id,
        currentTime: clip.in,
        playing: true,
        direction: 'forward',
        rate: 1,
        previewEnd: clip.out
      })
    },

    deselectClip: () => set({ selectedClipId: null }),

    updateClipTitle: (id, title) =>
      set((s) => {
        const others = s.clips.filter((c) => c.id !== id).map((c) => c.title)
        const unique = uniqueTitle(title.trim(), others)
        return { clips: s.clips.map((c) => (c.id === id ? { ...c, title: unique } : c)) }
      }),

    updateClipTimes: (id, inSec, outSec) =>
      set((s) => {
        const dur = s.video?.duration || 0
        const lo = Math.max(0, Math.min(inSec, outSec))
        const hi = Math.min(dur > 0 ? dur : Math.max(inSec, outSec), Math.max(inSec, outSec))
        return { clips: s.clips.map((c) => (c.id === id ? { ...c, in: lo, out: hi } : c)) }
      }),

    deleteClip: (id) =>
      set((s) => ({
        clips: s.clips.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })),
        selectedClipId: s.selectedClipId === id ? null : s.selectedClipId
      })),

    reorderClips: (from, to) =>
      set((s) => {
        if (from === to || from < 0 || to < 0 || from >= s.clips.length || to >= s.clips.length) {
          return {}
        }
        const arr = [...s.clips]
        const [moved] = arr.splice(from, 1)
        arr.splice(to, 0, moved)
        return { clips: arr.map((c, i) => ({ ...c, order: i })) }
      }),

    sortClipsByTime: () =>
      set((s) => ({
        clips: [...s.clips].sort((a, b) => a.in - b.in).map((c, i) => ({ ...c, order: i }))
      })),

    setMarkIn: () => {
      set({ markIn: get().currentTime })
      if (!get().playing) get().play() // 暂停时标记起点 → 自动开始播放
    },

    setMarkOut: () => {
      set({ markOut: get().currentTime })
      // 入点已标记 → 标完出点自动弹出命名框
      if (get().markIn != null) get().openTitleModal()
    },

    clearMarks: () => set({ markIn: null, markOut: null, titleModalOpen: false }),

    openTitleModal: () => {
      const { markIn, markOut, playing } = get()
      if (markIn == null || markOut == null) return
      // 命名时暂停，记住之前是否在播放
      get().pause()
      set({ titleModalOpen: true, resumeAfterModal: playing })
    },

    // 取消命名 = 未设定终点：清出点、保留入点，继续等待按 N（#24）
    closeTitleModal: () => {
      const resume = get().resumeAfterModal
      set({ markOut: null, titleModalOpen: false, resumeAfterModal: false })
      if (resume) get().resume()
    },

    addClip: (title, tags) => {
      const t = title.trim()
      // 空标题视为取消：终点不算设定（#24）
      if (!t) {
        get().closeTitleModal()
        return
      }
      const { markIn, markOut, clips, resumeAfterModal, videoTags } = get()
      if (markIn == null || markOut == null) return
      const lo = Math.min(markIn, markOut)
      const hi = Math.max(markIn, markOut)
      const cleanTags = Array.from(new Set((tags || []).map((x) => x.trim().slice(0, 15)).filter(Boolean)))
      const clip: Clip = {
        id: crypto.randomUUID(),
        in: lo,
        out: hi,
        title: uniqueTitle(t, clips.map((c) => c.title)),
        order: clips.length,
        created_at: new Date().toISOString(),
        tags: cleanTags
      }
      // 新标签并入视频标签
      const mergedVideoTags = Array.from(new Set([...videoTags, ...cleanTags]))
      set({
        clips: [...clips, clip],
        videoTags: mergedVideoTags,
        markIn: null,
        markOut: null,
        titleModalOpen: false,
        resumeAfterModal: false
      })
      if (resumeAfterModal) get().resume()
    },

    setDuration: (duration) => set((s) => (s.video ? { video: { ...s.video, duration } } : {})),
    setCurrentTime: (t) => {
      // 预览片段：到达出点自动暂停
      const { previewEnd } = get()
      if (previewEnd != null && t >= previewEnd) {
        set({ currentTime: previewEnd })
        get().pause()
        return
      }
      set({ currentTime: t })
    },
    setVideoEl: (el) => set({ videoEl: el }),

    seek: (t) => {
      const { videoEl, video } = get()
      if (!videoEl) return
      const dur = video?.duration || 0
      const clamped = Math.max(0, dur > 0 ? Math.min(dur, t) : t)
      videoEl.currentTime = clamped
      set({ currentTime: clamped })
    },

    play: () => {
      const { videoEl } = get()
      if (!videoEl) return
      stopReverse()
      videoEl.playbackRate = 1
      void videoEl.play()
      set({ playing: true, direction: 'forward', rate: 1 })
    },

    pause: () => {
      const { videoEl } = get()
      stopReverse()
      videoEl?.pause()
      // 保留 direction/rate，下次 resume 用同速继续（#31）
      set({ playing: false, previewEnd: null })
    },

    // 按当前方向/速率继续（空格用，不重置成 1x）
    resume: () => {
      const { direction, rate } = get()
      applySigned(direction === 'reverse' ? -rate : rate || 1)
    },

    togglePlay: () => (get().playing ? get().pause() : get().resume()),

    // 快进（L）：正放快放 2→4→8→2x（循环，#32）
    speedUp: () => {
      const { playing, direction, rate } = get()
      const inFast = playing && direction === 'forward' && FAST.includes(rate)
      if (inFast) applySigned(FAST[(FAST.indexOf(rate) + 1) % FAST.length])
      else applySigned(FAST[0])
    },

    // 快退（J）：倒放 1→2→4→1x（循环，#32）
    speedDown: () => {
      const { playing, direction, rate } = get()
      const inRev = playing && direction === 'reverse' && REV.includes(rate)
      if (inRev) applySigned(-REV[(REV.indexOf(rate) + 1) % REV.length])
      else applySigned(-REV[0])
    },

    // 控速（K）：正放正常→慢放循环 1→0.5→0.25→0.1→1（#20+#30）
    resetSpeed: () => {
      const { playing, direction, rate } = get()
      const inSlow = playing && direction === 'forward' && SLOW.includes(rate)
      if (inSlow) applySigned(SLOW[(SLOW.indexOf(rate) + 1) % SLOW.length])
      else applySigned(SLOW[0])
    },

    stepFrame: (dir) => {
      const { videoEl } = get()
      if (!videoEl) return
      get().pause()
      get().seek(videoEl.currentTime + dir * FRAME)
    },

    jump: (sec) => {
      const { videoEl } = get()
      if (!videoEl) return
      get().seek(videoEl.currentTime + sec)
    }
  }
})
