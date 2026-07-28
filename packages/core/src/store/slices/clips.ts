import type { StateCreator } from 'zustand'
import { uuid } from '../../utils/id'
import type { Clip } from '../../types'
import type { AppState, ClipsSlice } from '../types'
import { globalToLocal, localToGlobal, videoOffset } from '../../utils/timeline'

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

export const createClipsSlice: StateCreator<AppState, [], [], ClipsSlice> = (set, get) => ({
  clips: [],
  markIn: null,
  markOut: null,
  titleModalOpen: false,
  resumeAfterModal: false,
  selectedClipId: null,
  lastClipTrimmed: false,

  setMarkIn: () => {
    set({ markIn: get().currentTime })
    if (!get().playing) get().play()
  },

  setMarkOut: () => {
    set({ markOut: get().currentTime })
    if (get().markIn != null) get().openTitleModal()
  },

  clearMarks: () => set({ markIn: null, markOut: null, titleModalOpen: false }),

  openTitleModal: () => {
    const { markIn, markOut, playing } = get()
    if (markIn == null || markOut == null) return
    get().pause()
    set({ titleModalOpen: true, resumeAfterModal: playing })
  },

  closeTitleModal: () => {
    const resume = get().resumeAfterModal
    set({ markOut: null, titleModalOpen: false, resumeAfterModal: false })
    if (resume) get().resume()
  },

  addClip: (title, tags) => {
    const t = title.trim()
    if (!t) {
      get().closeTitleModal()
      return
    }
    const { markIn, markOut, clips, resumeAfterModal, videoTags, videos } = get()
    if (markIn == null || markOut == null) return
    const lo = Math.min(markIn, markOut)
    const hi = Math.max(markIn, markOut)
    const loc = globalToLocal(videos, lo)
    if (!loc) return
    const offset = videoOffset(videos, loc.video.id)
    const inLocal = lo - offset
    // 片段不能跨文件（片段随视频存 sidecar，跨了就没法归属）：出点钳到所属视频末尾
    const wantOut = hi - offset
    const outLocal = Math.min(wantOut, loc.video.duration || wantOut)
    // 被钳过说明标记跨过了视频边界，记下来让界面能提示，别悄悄截断
    set({ lastClipTrimmed: outLocal < wantOut - 0.05 })
    if (outLocal - inLocal < 0.02) return // 太短或跨界
    const cleanTags = Array.from(
      new Set((tags || []).map((x) => x.trim().slice(0, 15)).filter(Boolean))
    )
    const clip: Clip = {
      id: uuid(),
      videoId: loc.video.id,
      in: inLocal,
      out: outLocal,
      title: uniqueTitle(t, clips.map((c) => c.title)),
      order: clips.length,
      created_at: new Date().toISOString(),
      tags: cleanTags
    }
    set({
      clips: [...clips, clip],
      videoTags: Array.from(new Set([...videoTags, ...cleanTags])),
      markIn: null,
      markOut: null,
      titleModalOpen: false,
      resumeAfterModal: false
    })
    if (resumeAfterModal) get().resume()
  },

  // 选中即从入点播放，到出点自动暂停（全局时间，跨文件）
  selectClip: (id) => {
    const { clips, videos } = get()
    const clip = clips.find((c) => c.id === id)
    if (!clip) return
    const globalIn = localToGlobal(videos, clip.videoId, clip.in)
    const globalOut = localToGlobal(videos, clip.videoId, clip.out)
    get().pause()
    set({ selectedClipId: id })
    const beforeActive = get().activeVideoId
    get().seek(globalIn)
    // previewStart 非空 → 到 out 自动回到 in 循环（#102）
    set({ previewStart: globalIn, previewEnd: globalOut, previewEntered: false, playing: true, direction: 'forward', rate: 1 })
    // 跨视频时 seek 只是记下 pendingSeekLocal 并切 activeVideoId，此刻 player 还是旧视频的：
    // 对它 play() 会让「上一个视频」从原位置播起来。交给新视频加载后的 applyPendingSeek 去 seek+play。
    if (get().activeVideoId === beforeActive) {
      const p = get().player
      if (p) {
        p.setRate(1)
        p.play()
      }
    }
  },

  deselectClip: () => set({ selectedClipId: null, previewStart: null, previewEnd: null, previewEntered: false }),

  updateClipTitle: (id, title) =>
    set((s) => {
      const others = s.clips.filter((c) => c.id !== id).map((c) => c.title)
      const unique = uniqueTitle(title.trim(), others)
      return { clips: s.clips.map((c) => (c.id === id ? { ...c, title: unique } : c)) }
    }),

  // in/out 为局部时间，钳到所属视频时长内
  updateClipTimes: (id, inLocal, outLocal) =>
    set((s) => {
      const clip = s.clips.find((c) => c.id === id)
      if (!clip) return {}
      const v = s.videos.find((x) => x.id === clip.videoId)
      const dur = v?.duration || 0
      const lo = Math.max(0, Math.min(inLocal, outLocal))
      const hi = Math.min(dur > 0 ? dur : Math.max(inLocal, outLocal), Math.max(inLocal, outLocal))
      return { clips: s.clips.map((c) => (c.id === id ? { ...c, in: lo, out: hi } : c)) }
    }),

  deleteClip: (id) =>
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })),
      selectedClipId: s.selectedClipId === id ? null : s.selectedClipId
    }))
})
