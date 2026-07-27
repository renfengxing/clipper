import type { StateCreator } from 'zustand'
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
    // 片段不能跨文件：出点钳到所属视频末尾
    const outLocal = Math.min(hi - offset, loc.video.duration || hi - offset)
    if (outLocal - inLocal < 0.02) return // 太短或跨界
    const cleanTags = Array.from(
      new Set((tags || []).map((x) => x.trim().slice(0, 15)).filter(Boolean))
    )
    const clip: Clip = {
      id: crypto.randomUUID(),
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
    get().seek(globalIn)
    // previewStart 非空 → 到 out 自动回到 in 循环（#102）
    set({ previewStart: globalIn, previewEnd: globalOut, playing: true, direction: 'forward', rate: 1 })
    const p = get().player
    if (p) {
      p.setRate(1)
      p.play()
    }
  },

  deselectClip: () => set({ selectedClipId: null, previewStart: null, previewEnd: null }),

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
